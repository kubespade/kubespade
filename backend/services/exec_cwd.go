package services

// BuildPodExecCommand returns argv for interactive pod exec with silent cwd OSC
// integration (ESC]7777;cwd=PATH BEL). Installed via --rcfile / PROMPT_COMMAND so
// nothing is typed into the PTY and the normal bash prompt (with path) still loads.
func BuildPodExecCommand(shell string) []string {
	switch shell {
	case "/bin/bash":
		return []string{"/bin/sh", "-c", bashCwdExecScript}
	case "/bin/ash":
		return []string{"/bin/sh", "-c", ashCwdExecScript}
	default:
		return []string{"/bin/sh", "-c", shCwdExecScript}
	}
}

// Interactive bash with a temp rcfile: source real bashrc (PS1 with path), then cwd hook.
// Avoids --norc, which left the bare "bash-5.2#" prompt.
const bashCwdExecScript = `[ -x /bin/bash ] || exec /bin/sh
rc=""
for d in /tmp /dev/shm /var/tmp; do
  if [ -d "$d" ] && [ -w "$d" ]; then
    rc="$d/.kubespade_bashrc_$$"
    break
  fi
done
if [ -n "$rc" ]; then
  if cat > "$rc" <<EOF
_ks_pwd(){ printf '\033]7777;cwd=%s\007' "\$PWD" 2>/dev/null; }
export -f _ks_pwd
[ -r /etc/bash.bashrc ] && . /etc/bash.bashrc
[ -r "\$HOME/.bashrc" ] && . "\$HOME/.bashrc"
case "\$PROMPT_COMMAND" in
  *_ks_pwd*) ;;
  *) PROMPT_COMMAND="_ks_pwd\${PROMPT_COMMAND:+; \$PROMPT_COMMAND}" ;;
esac
export PROMPT_COMMAND
_ks_pwd
rm -f -- $rc
EOF
  then
    exec /bin/bash --rcfile "$rc" -i
  fi
fi
PROMPT_COMMAND='printf "\033]7777;cwd=%s\007" "$PWD" 2>/dev/null'
export PROMPT_COMMAND
exec /bin/bash -i`

// ash/busybox: prefer keeping the shell's own PS1; emit cwd via PROMPT-less PS1 prefix only
// when we must. Start interactive first so ash sets its prompt, then we can't wrap easily —
// use ENV file when writable.
const ashCwdExecScript = `[ -x /bin/ash ] || exec /bin/sh
envf=""
for d in /tmp /dev/shm /var/tmp; do
  if [ -d "$d" ] && [ -w "$d" ]; then
    envf="$d/.kubespade_ashenv_$$"
    break
  fi
done
if [ -n "$envf" ]; then
  if cat > "$envf" <<EOF
printf '\033]7777;cwd=%s\007' "\$PWD" 2>/dev/null
PS1="\$(printf '\033]7777;cwd=%s\007' \"\$PWD\" 2>/dev/null)\${PS1:-\$ }"
rm -f -- $envf
EOF
  then
    ENV="$envf" export ENV
    exec /bin/ash -i
  fi
fi
exec /bin/ash -i`

const shCwdExecScript = `envf=""
for d in /tmp /dev/shm /var/tmp; do
  if [ -d "$d" ] && [ -w "$d" ]; then
    envf="$d/.kubespade_shenv_$$"
    break
  fi
done
if [ -n "$envf" ]; then
  if cat > "$envf" <<EOF
printf '\033]7777;cwd=%s\007' "\$PWD" 2>/dev/null
PS1="\$(printf '\033]7777;cwd=%s\007' \"\$PWD\" 2>/dev/null)\${PS1:-\$ }"
rm -f -- $envf
EOF
  then
    ENV="$envf" export ENV
    exec /bin/sh -i
  fi
fi
exec /bin/sh -i`
