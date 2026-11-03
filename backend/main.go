package main

import (
	"bytes"
	"embed"
	"fmt"
	"html"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"k8s-client/debug"
	"k8s-client/handlers"
	"k8s-client/mcp"
	"k8s-client/services"
	"k8s-client/session"
)

//go:embed dist
var frontendFS embed.FS

func main() {
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		if err := mcp.Run(); err != nil {
			fmt.Fprintln(os.Stderr, "kubespade mcp:", err)
			os.Exit(1)
		}
		return
	}

	// Route all Go log output through the debug buffer (silent when debug is off).
	log.SetOutput(debug.GoWriter{})
	log.SetFlags(0)

	// GUI apps (Electron on macOS) often start with a stripped PATH — ensure
	// kubeconfig exec plugins like aws-vault / aws are discoverable.
	services.EnrichPATH()

	gin.SetMode(gin.ReleaseMode)

	services.MigrateLegacyDataDir()
	if err := services.EnsureDataDirSafe(); err != nil {
		fmt.Fprintln(os.Stderr, "data dir check failed:", err)
		os.Exit(1)
	}

	if _, err := services.GetPassphrase(); err != nil {
		fmt.Fprintln(os.Stderr, "passphrase init failed:", err)
		os.Exit(1)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "4466"
	}
	// Electron sets PORT=0 to request an ephemeral loopback port; net.Listen
	// accepts "0" directly and we read the real port back from the listener.

	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		fmt.Fprintln(os.Stderr, "listen failed:", err)
		os.Exit(1)
	}
	actualPort := ln.Addr().(*net.TCPAddr).Port
	// Advertise readiness BEFORE session hydrate — hydrate may hit clusters/cloud
	// and must not block the Electron window when offline / VPN is broken.
	// Flush: when stdout is a pipe (Electron spawn), Go fully buffers stdout and
	// the READY line may never reach the parent until the buffer fills.
	fmt.Printf("K8S_CLIENT_READY 127.0.0.1:%d\n", actualPort)
	_ = os.Stdout.Sync()

	go func() {
		session.Hydrate()
		session.StartHealthChecks()
	}()

	r := gin.New()
	r.UseRawPath = true
	r.Use(gin.Recovery())
	r.Use(corsConfig(actualPort))
	r.Use(httpDebugMiddleware())

	api := r.Group("/api")
	api.Use(handlers.RequireAPIToken())
	{
		api.GET("/debug", handlers.GetDebugState)
		api.POST("/debug", handlers.SetDebugState)
		api.GET("/debug/logs", handlers.GetDebugLogs)

		api.GET("/ui-prefs", handlers.GetUIPrefs)
		api.PUT("/ui-prefs", handlers.PutUIPrefs)

		g := api.Group("/groups")
		{
			g.GET("", handlers.ListGroups)
			g.POST("", handlers.CreateGroup)
			g.DELETE("/:name", handlers.DeleteGroupHandler)
			g.PATCH("/:name", handlers.RenameGroupHandler)
		}

		api.POST("/kubeconfig/preview", handlers.PreviewKubeconfig)
		api.GET("/kubeconfig/default", handlers.GetDefaultKubeconfig)
		api.POST("/kubeconfig/unlink", handlers.UnlinkLiveKubeconfig)

		api.POST("/ai/workspace", handlers.CreateAIWorkspace)
		api.DELETE("/ai/workspace", handlers.DeleteAIWorkspace)

		p := api.Group("/profiles")
		{
			p.GET("", handlers.ListProfiles)
			p.POST("", handlers.AddProfile)
			p.DELETE("/:name", handlers.DeleteProfile)
			p.POST("/:name/disconnect", handlers.DisconnectProfile)
			p.GET("/:name/clusters", handlers.ListClusters)
			p.POST("/:name/session", handlers.SeedProfileSession)
			p.POST("/:name/auth", handlers.AuthProfile)
			p.PUT("/:name/group", handlers.SetProfileGroupHandler)
			p.PUT("/:name/display-name", handlers.SetProfileDisplayNameHandler)
			p.GET("/:name/k8s/info", handlers.GetClusterInfo)
			p.GET("/:name/k8s/watch", handlers.StreamClusterInfo)
			p.GET("/:name/k8s/applications", handlers.GetApplications)
			p.GET("/:name/k8s/network-map", handlers.GetNetworkMap)
			p.POST("/:name/k8s/apply", handlers.ApplyManifest)
			p.POST("/:name/k8s/auth/check", handlers.CheckAccessHandler)
			p.GET("/:name/k8s/resources/:kind", handlers.GetResources)
			p.POST("/:name/k8s/resources/:kind", handlers.CreateResource)
			p.GET("/:name/k8s/watch-resources/:kind", handlers.StreamResources)
			p.GET("/:name/k8s/resources/:kind/:resourceName", handlers.GetResourceYAML)
			p.PUT("/:name/k8s/resources/:kind/:resourceName", handlers.ApplyResourceYAML)
			p.DELETE("/:name/k8s/resources/:kind/:resourceName", handlers.DeleteResource)
			p.GET("/:name/k8s/resources/:kind/:resourceName/detail", handlers.GetResourceDetail)
			p.GET("/:name/k8s/resources/:kind/:resourceName/events", handlers.GetResourceEvents)
			p.POST("/:name/k8s/resources/:kind/:resourceName/restart", handlers.RestartWorkload)
			p.POST("/:name/k8s/resources/:kind/:resourceName/scale", handlers.ScaleWorkload)
			p.POST("/:name/k8s/resources/cronjobs/:resourceName/suspend", handlers.SuspendCronJob)
			p.POST("/:name/k8s/resources/cronjobs/:resourceName/resume", handlers.ResumeCronJob)
			p.POST("/:name/k8s/resources/cronjobs/:resourceName/trigger", handlers.TriggerCronJob)
			p.POST("/:name/k8s/resources/deployments/:resourceName/pause", handlers.PauseDeployment)
			p.POST("/:name/k8s/resources/deployments/:resourceName/resume", handlers.ResumeDeployment)
			p.POST("/:name/k8s/resources/deployments/:resourceName/undo", handlers.UndoDeployment)
			p.GET("/:name/k8s/resources/deployments/:resourceName/revisions", handlers.ListDeploymentRevisions)
			p.POST("/:name/k8s/resources/certificatesigningrequests/:resourceName/approve", handlers.ApproveCSR)
			p.POST("/:name/k8s/resources/certificatesigningrequests/:resourceName/deny", handlers.DenyCSR)
			p.POST("/:name/k8s/resources/pods/:resourceName/evict", handlers.EvictPod)
			p.GET("/:name/k8s/pods/:podName/logs", handlers.StreamPodLogs)
			p.GET("/:name/k8s/pods/:podName/containers", handlers.GetPodContainers)
			p.GET("/:name/k8s/pods/:podName/metrics", handlers.GetPodMetrics)
			p.GET("/:name/k8s/pods/:podName/metrics/history", handlers.GetPodMetricsHistory)
			p.GET("/:name/k8s/pod-metrics", handlers.ListPodMetrics)
			p.GET("/:name/k8s/node-metrics", handlers.ListNodeMetrics)
			p.GET("/:name/k8s/nodes/:nodeName/metrics", handlers.GetNodeMetricsHandler)
			p.GET("/:name/k8s/nodes/:nodeName/metrics/history", handlers.GetNodeMetricsHistory)
			p.GET("/:name/k8s/cluster-metrics-collector", handlers.GetClusterMetricsCollector)
			p.PUT("/:name/k8s/cluster-metrics-collector", handlers.PutClusterMetricsCollector)
			p.GET("/:name/k8s/cluster-metrics-collector/history/:kind", handlers.GetClusterMetricsCollectorHistory)
			p.GET("/:name/k8s/metrics-source", handlers.GetMetricsSource)
			p.PUT("/:name/k8s/metrics-source", handlers.PutMetricsSource)
			p.GET("/:name/k8s/prometheus/discover", handlers.DiscoverPrometheusHandler)
			p.POST("/:name/k8s/nodes/:nodeName/cordon", handlers.CordonNodeHandler)
			p.POST("/:name/k8s/nodes/:nodeName/uncordon", handlers.UncordonNodeHandler)
			p.GET("/:name/k8s/nodes/:nodeName/drain", handlers.DrainNodeHandler)
			p.GET("/:name/k8s/nodes/:nodeName/pods", handlers.ListNodePodsHandler)
			p.GET("/:name/k8s/nodes/:nodeName/taints", handlers.ListNodeTaintsHandler)
			p.POST("/:name/k8s/nodes/:nodeName/taints", handlers.AddNodeTaintHandler)
			p.DELETE("/:name/k8s/nodes/:nodeName/taints", handlers.RemoveNodeTaintHandler)
			p.GET("/:name/k8s/pods/:podName/exec", handlers.ExecPodContainer)
			p.POST("/:name/k8s/pods/:podName/files/stat", handlers.StatPodFile)
			p.POST("/:name/k8s/pods/:podName/files/list", handlers.ListPodFiles)
			p.POST("/:name/k8s/pods/:podName/files/pull", handlers.PullPodFile)
			p.POST("/:name/k8s/pods/:podName/files/push", handlers.PushPodFile)
			p.GET("/:name/k8s/nodes/:nodeName/exec", handlers.ExecNode)
			p.GET("/:name/k8s/crd/groups", handlers.GetCRDGroups)
			p.GET("/:name/k8s/watch-crd/:group/:version/:plural", handlers.StreamCRDInstances)
			p.GET("/:name/k8s/crd/:group/:version/:plural/:resourceName", handlers.GetCRDResourceYAML)
			p.PUT("/:name/k8s/crd/:group/:version/:plural/:resourceName", handlers.ApplyCRDResourceYAML)
			p.DELETE("/:name/k8s/crd/:group/:version/:plural/:resourceName", handlers.DeleteCRDResource)
			p.GET("/:name/k8s/crd/:group/:version/:plural/:resourceName/detail", handlers.GetCRDResourceDetail)
			p.GET("/:name/k8s/crd/:group/:version/:plural/:resourceName/events", handlers.GetCRDResourceEvents)
			p.GET("/:name/k8s/helm/releases", handlers.GetHelmReleases)
			p.GET("/:name/k8s/helm/charts", handlers.GetHelmCharts)
			p.GET("/:name/k8s/helm/repos", handlers.GetHelmRepos)
			p.GET("/:name/k8s/helm/repo-charts", handlers.GetHelmRepoCharts)
			p.GET("/:name/k8s/helm/chart-values", handlers.GetHelmChartValues)
			p.POST("/:name/k8s/helm/releases", handlers.InstallHelmRelease)
			p.GET("/:name/k8s/helm/releases/:namespace/:releaseName/history", handlers.GetHelmReleaseHistory)
			p.GET("/:name/k8s/helm/releases/:namespace/:releaseName/values", handlers.GetHelmReleaseValues)
			p.PUT("/:name/k8s/helm/releases/:namespace/:releaseName", handlers.UpgradeHelmRelease)
			p.DELETE("/:name/k8s/helm/releases/:namespace/:releaseName", handlers.UninstallHelmRelease)
			p.POST("/:name/k8s/helm/releases/:namespace/:releaseName/rollback", handlers.RollbackHelmRelease)
			p.GET("/:name/k8s/portforwards", handlers.ListPortForwards)
			p.POST("/:name/k8s/portforwards", handlers.StartPortForward)
			p.POST("/:name/k8s/services/:serviceName/portforward", handlers.StartServicePortForward)
			p.DELETE("/:name/k8s/portforwards/:id", handlers.StopPortForward)
		}
	}

	sub, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		fmt.Fprintln(os.Stderr, "embed sub failed:", err)
		os.Exit(1)
	}

	indexHTML, _ := fs.ReadFile(sub, "index.html")
	if len(indexHTML) == 0 {
		indexHTML = []byte("<h1>Frontend not built. Run: cd frontend && npm run build</h1>")
	}
	indexHTML = injectAPIToken(indexHTML, services.APIToken())

	if assetsFS, aErr := fs.Sub(sub, "assets"); aErr == nil {
		r.StaticFS("/assets", http.FS(assetsFS))
	}

	r.NoRoute(func(c *gin.Context) {
		c.Header("Content-Security-Policy", cspHeader())
		c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
	})

	srv := &http.Server{Handler: r}
	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "server error:", err)
		os.Exit(1)
	}
}

func corsConfig(port int) gin.HandlerFunc {
	origins := []string{
		fmt.Sprintf("http://127.0.0.1:%d", port),
		fmt.Sprintf("http://localhost:%d", port),
	}
	// Vite dev server (optional).
	if os.Getenv("K8S_CLIENT_DEV") == "1" || os.Getenv("VITE_DEV") == "1" {
		origins = append(origins,
			"http://127.0.0.1:5173",
			"http://localhost:5173",
		)
	}
	return cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization", "X-K8s-Api-Token"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	})
}

func injectAPIToken(page []byte, token string) []byte {
	meta := []byte(fmt.Sprintf(
		`<meta name="k8s-api-token" content="%s" />`,
		html.EscapeString(token),
	))
	lower := bytes.ToLower(page)
	idx := bytes.Index(lower, []byte("<head>"))
	if idx < 0 {
		return append(meta, page...)
	}
	insertAt := idx + len("<head>")
	out := make([]byte, 0, len(page)+len(meta)+1)
	out = append(out, page[:insertAt]...)
	out = append(out, '\n')
	out = append(out, meta...)
	out = append(out, page[insertAt:]...)
	return out
}

func cspHeader() string {
	// SPA + CodeMirror/xterm need 'unsafe-inline' for style; scripts are bundled modules.
	parts := []string{
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self'",
	}
	return strings.Join(parts, "; ")
}

func httpDebugMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		if debug.IsEnabled() {
			debug.Log("HTTP", fmt.Sprintf("%s %s → %d (%s)",
				c.Request.Method, c.Request.URL.Path,
				c.Writer.Status(), time.Since(start).Round(time.Millisecond)))
		}
	}
}
