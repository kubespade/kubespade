package services

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
)

// ExecContainerNoTTY runs a non-interactive command in a pod (used for tar copy).
func ExecContainerNoTTY(
	ctx context.Context,
	k8sCfg *rest.Config,
	namespace, podName, container string,
	cmd []string,
	stdin io.Reader,
	stdout, stderr io.Writer,
) error {
	client, err := kubernetes.NewForConfig(k8sCfg)
	if err != nil {
		return err
	}

	req := client.CoreV1().RESTClient().Post().
		Resource("pods").
		Name(podName).
		Namespace(namespace).
		SubResource("exec")

	opts := &corev1.PodExecOptions{
		Container: container,
		Command:   cmd,
		Stdout:    true,
		Stderr:    true,
		TTY:       false,
	}
	if stdin != nil {
		opts.Stdin = true
	}
	req.VersionedParams(opts, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(k8sCfg, "POST", req.URL())
	if err != nil {
		return err
	}

	var stdinR io.Reader
	if stdin != nil {
		stdinR = stdin
	}
	return executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:  stdinR,
		Stdout: stdout,
		Stderr: stderr,
		Tty:    false,
	})
}

// NormalizePodPath rejects empty / relative paths for remote copy.
func NormalizePodPath(remote string) (string, error) {
	p := strings.TrimSpace(remote)
	if p == "" {
		return "", fmt.Errorf("remote path is required")
	}
	if !strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("remote path must be absolute")
	}
	if strings.Contains(p, "\x00") {
		return "", fmt.Errorf("invalid remote path")
	}
	cleaned := path.Clean(p)
	if cleaned != "/" && strings.HasSuffix(p, "/") && cleaned != p {
		// keep intentional trailing slash meaning for dirs? Clean drops it — OK.
	}
	return cleaned, nil
}

// StatPodPath returns "file", "dir", or "missing".
func StatPodPath(
	ctx context.Context,
	k8sCfg *rest.Config,
	namespace, podName, container, remotePath string,
) (string, error) {
	remotePath, err := NormalizePodPath(remotePath)
	if err != nil {
		return "", err
	}
	script := fmt.Sprintf(
		`if [ -d %q ]; then printf dir; elif [ -e %q ]; then printf file; else printf missing; fi`,
		remotePath, remotePath,
	)
	var stdout, stderr bytes.Buffer
	err = ExecContainerNoTTY(ctx, k8sCfg, namespace, podName, container,
		[]string{"sh", "-c", script}, nil, &stdout, &stderr)
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return "", fmt.Errorf("%w: %s", err, msg)
		}
		return "", err
	}
	kind := strings.TrimSpace(stdout.String())
	switch kind {
	case "file", "dir", "missing":
		return kind, nil
	default:
		return "", fmt.Errorf("unexpected stat result %q", kind)
	}
}

// CopyFromPod copies remotePath (file or directory) from the pod to localPath.
// For a remote file, localPath is the destination file path.
// For a remote directory, localPath is the destination directory (created if needed);
// the remote directory's basename is placed inside it (kubectl cp semantics).
func CopyFromPod(
	ctx context.Context,
	k8sCfg *rest.Config,
	namespace, podName, container, remotePath, localPath string,
) error {
	remotePath, err := NormalizePodPath(remotePath)
	if err != nil {
		return err
	}
	localPath = filepath.Clean(localPath)
	if localPath == "" || localPath == "." {
		return fmt.Errorf("local path is required")
	}

	kind, err := StatPodPath(ctx, k8sCfg, namespace, podName, container, remotePath)
	if err != nil {
		return err
	}
	if kind == "missing" {
		return fmt.Errorf("remote path not found: %s", remotePath)
	}

	parent := path.Dir(remotePath)
	base := path.Base(remotePath)
	if remotePath == "/" {
		parent = "/"
		base = "."
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	pr, pw := io.Pipe()
	var stderr bytes.Buffer
	errCh := make(chan error, 1)
	go func() {
		defer pw.Close()
		errCh <- ExecContainerNoTTY(ctx, k8sCfg, namespace, podName, container,
			[]string{"tar", "cf", "-", "-C", parent, base}, nil, pw, &stderr)
	}()

	untarErr := untarToLocal(pr, localPath, kind == "dir", base)
	_ = pr.Close() // unblock writer if SPDY is still open
	cancel()       // SPDY often hangs after tar EOF; cancel once bytes are extracted
	execErr := waitCopyExec(errCh, 5*time.Second, cancel)

	if untarErr != nil {
		return untarErr
	}
	// Tar stream fully consumed — treat cancel/close as success.
	if execErr != nil && !isBenignCopyExecErr(execErr) {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return fmt.Errorf("%w: %s", execErr, msg)
		}
		return execErr
	}
	return nil
}

// CopyToPod copies localPath (file or directory) into remoteDir inside the pod.
// The basename of localPath is created under remoteDir.
func CopyToPod(
	ctx context.Context,
	k8sCfg *rest.Config,
	namespace, podName, container, remoteDir, localPath string,
) error {
	remoteDir, err := NormalizePodPath(remoteDir)
	if err != nil {
		return err
	}
	localPath = filepath.Clean(localPath)
	st, err := os.Stat(localPath)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Ensure remote destination directory exists.
	var mkdirOut, mkdirErrBuf bytes.Buffer
	mkdirCmd := []string{"sh", "-c", fmt.Sprintf("mkdir -p %q", remoteDir)}
	if err := ExecContainerNoTTY(ctx, k8sCfg, namespace, podName, container, mkdirCmd, nil, &mkdirOut, &mkdirErrBuf); err != nil {
		msg := strings.TrimSpace(mkdirErrBuf.String())
		if msg != "" {
			return fmt.Errorf("mkdir remote: %w: %s", err, msg)
		}
		return fmt.Errorf("mkdir remote: %w", err)
	}

	pr, pw := io.Pipe()
	tarErrCh := make(chan error, 1)
	go func() {
		defer pw.Close()
		tarErrCh <- tarLocalToWriter(pw, localPath, st.IsDir())
	}()

	var stderr bytes.Buffer
	execErrCh := make(chan error, 1)
	go func() {
		execErrCh <- ExecContainerNoTTY(ctx, k8sCfg, namespace, podName, container,
			[]string{"tar", "xf", "-", "-C", remoteDir}, pr, io.Discard, &stderr)
	}()

	tarErr := waitCopyExec(tarErrCh, 30*time.Minute, cancel)
	_ = pr.Close()
	cancel()
	execErr := waitCopyExec(execErrCh, 5*time.Second, cancel)

	if tarErr != nil && !isBenignCopyExecErr(tarErr) {
		return tarErr
	}
	if execErr != nil && !isBenignCopyExecErr(execErr) {
		msg := strings.TrimSpace(stderr.String())
		if msg != "" {
			return fmt.Errorf("%w: %s", execErr, msg)
		}
		return execErr
	}
	return nil
}

func waitCopyExec(errCh <-chan error, timeout time.Duration, cancel context.CancelFunc) error {
	select {
	case err := <-errCh:
		return err
	case <-time.After(timeout):
		cancel()
		select {
		case err := <-errCh:
			return err
		case <-time.After(2 * time.Second):
			return context.Canceled
		}
	}
}

func isBenignCopyExecErr(err error) bool {
	if err == nil {
		return true
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	if errors.Is(err, io.ErrClosedPipe) || errors.Is(err, io.EOF) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "context canceled") ||
		strings.Contains(msg, "closed pipe") ||
		strings.Contains(msg, "connection reset")
}

func tarLocalToWriter(w io.Writer, localPath string, isDir bool) error {
	tw := tar.NewWriter(w)
	defer tw.Close()
	base := filepath.Base(localPath)
	if isDir {
		return filepath.Walk(localPath, func(p string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			rel, err := filepath.Rel(localPath, p)
			if err != nil {
				return err
			}
			name := path.Join(base, filepath.ToSlash(rel))
			if rel == "." {
				name = base
			}
			return writeTarEntry(tw, p, name, info)
		})
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return err
	}
	return writeTarEntry(tw, localPath, base, info)
}

func writeTarEntry(tw *tar.Writer, diskPath, name string, info os.FileInfo) error {
	header, err := tar.FileInfoHeader(info, "")
	if err != nil {
		return err
	}
	header.Name = name
	if info.IsDir() {
		header.Name = strings.TrimSuffix(name, "/") + "/"
		header.Typeflag = tar.TypeDir
	}
	if err := tw.WriteHeader(header); err != nil {
		return err
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return nil
	}
	f, err := os.Open(diskPath)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(tw, f)
	return err
}

func untarToLocal(r io.Reader, localPath string, remoteIsDir bool, remoteBase string) error {
	tr := tar.NewReader(r)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := path.Clean("/" + hdr.Name)
		name = strings.TrimPrefix(name, "/")
		if name == "" || name == "." {
			continue
		}
		if strings.Contains(name, "..") {
			return fmt.Errorf("refusing unsafe tar entry %q", hdr.Name)
		}

		var dest string
		if !remoteIsDir {
			// Single file: write directly to localPath.
			dest = localPath
			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return err
			}
		} else {
			// Directory: strip remote base prefix and place under localPath/remoteBase.
			rel := name
			prefix := remoteBase + "/"
			if name == remoteBase {
				rel = remoteBase
			} else if strings.HasPrefix(name, prefix) {
				rel = name
			}
			dest = filepath.Join(localPath, filepath.FromSlash(rel))
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(dest, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(dest, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(hdr.Mode)|0o600)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(f, tr)
			closeErr := f.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		default:
			// skip symlinks / specials for safety
			continue
		}
	}
}

// PodDirEntry is one file or directory from ListPodDirectory.
type PodDirEntry struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // "file" | "dir"
	Size int64  `json:"size"`
}

// ListPodDirectoryResult is a directory listing (possibly truncated).
type ListPodDirectoryResult struct {
	Entries   []PodDirEntry `json:"entries"`
	Truncated bool          `json:"truncated"`
}

const maxPodDirEntries = 2000

func shellSingleQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// ListPodDirectory lists direct children of remotePath inside the container.
// Uses a single `ls -1Ap` (no per-file stat) so large directories stay responsive.
// When nameFilter is non-empty, searches the whole directory (grep -F) and returns
// matching names only — not limited to the first 2000 browse entries.
func ListPodDirectory(
	ctx context.Context,
	k8sCfg *rest.Config,
	namespace, podName, container, remotePath, nameFilter string,
) (ListPodDirectoryResult, error) {
	remotePath, err := NormalizePodPath(remotePath)
	if err != nil {
		return ListPodDirectoryResult{}, err
	}
	nameFilter = strings.TrimSpace(nameFilter)

	var script string
	if nameFilter != "" {
		// Fixed-string case-insensitive match over the full directory listing.
		script = fmt.Sprintf(`
dir=%q
if [ ! -e "$dir" ]; then printf 'ERR\tmissing\n'; exit 0; fi
if [ ! -d "$dir" ]; then printf 'ERR\tnotdir\n'; exit 0; fi
ls -1Ap "$dir" 2>/dev/null | grep -F -i -- %s | head -n %d
`, remotePath, shellSingleQuote(nameFilter), maxPodDirEntries+1)
	} else {
		script = fmt.Sprintf(`
dir=%q
if [ ! -e "$dir" ]; then printf 'ERR\tmissing\n'; exit 0; fi
if [ ! -d "$dir" ]; then printf 'ERR\tnotdir\n'; exit 0; fi
ls -1Ap "$dir" 2>/dev/null | head -n %d
`, remotePath, maxPodDirEntries+1)
	}

	cfg := rest.CopyConfig(k8sCfg)
	cfg.Timeout = 0

	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	var stdout, stderr bytes.Buffer
	errCh := make(chan error, 1)
	go func() {
		errCh <- ExecContainerNoTTY(ctx, cfg, namespace, podName, container,
			[]string{"sh", "-c", script}, nil, &stdout, &stderr)
	}()

	select {
	case err = <-errCh:
	case <-ctx.Done():
		cancel()
		<-errCh
		err = ctx.Err()
	}
	if err != nil && !isBenignCopyExecErr(err) {
		msg := strings.TrimSpace(stderr.String())
		if stdout.Len() == 0 {
			if msg != "" {
				return ListPodDirectoryResult{}, fmt.Errorf("%w: %s", err, msg)
			}
			return ListPodDirectoryResult{}, err
		}
	}

	out := stdout.String()
	if strings.HasPrefix(out, "ERR\tmissing") {
		return ListPodDirectoryResult{}, fmt.Errorf("remote path not found: %s", remotePath)
	}
	if strings.HasPrefix(out, "ERR\tnotdir") {
		return ListPodDirectoryResult{}, fmt.Errorf("not a directory: %s", remotePath)
	}

	var entries []PodDirEntry
	lineCount := 0
	for _, line := range strings.Split(out, "\n") {
		name := strings.TrimRight(line, "\r")
		if name == "" {
			continue
		}
		lineCount++
		if len(entries) >= maxPodDirEntries {
			continue
		}
		kind := "file"
		if strings.HasSuffix(name, "/") {
			kind = "dir"
			name = strings.TrimSuffix(name, "/")
		}
		name = strings.TrimRight(name, "*@=|")
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "\t\x00") {
			continue
		}
		entries = append(entries, PodDirEntry{Name: name, Kind: kind, Size: 0})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == "dir"
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	if entries == nil {
		entries = []PodDirEntry{}
	}
	return ListPodDirectoryResult{
		Entries:   entries,
		Truncated: lineCount > maxPodDirEntries,
	}, nil
}
