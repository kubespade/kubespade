package services

import (
	"fmt"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
)

// restClientGetter adapts *rest.Config for Helm action.Configuration.Init.
type restClientGetter struct {
	cfg       *rest.Config
	namespace string
}

func (g *restClientGetter) ToRESTConfig() (*rest.Config, error) {
	if g.cfg == nil {
		return nil, fmt.Errorf("rest config is nil")
	}
	// Copy so Helm/discovery burst tweaks don't mutate the session config.
	cp := *g.cfg
	return &cp, nil
}

func (g *restClientGetter) ToDiscoveryClient() (discovery.CachedDiscoveryInterface, error) {
	cfg, err := g.ToRESTConfig()
	if err != nil {
		return nil, err
	}
	cfg.Burst = 100
	dc, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return nil, err
	}
	return memory.NewMemCacheClient(dc), nil
}

func (g *restClientGetter) ToRESTMapper() (meta.RESTMapper, error) {
	dc, err := g.ToDiscoveryClient()
	if err != nil {
		return nil, err
	}
	mapper := restmapper.NewDeferredDiscoveryRESTMapper(dc)
	return restmapper.NewShortcutExpander(mapper, dc, func(string) {}), nil
}

func (g *restClientGetter) ToRawKubeConfigLoader() clientcmd.ClientConfig {
	overrides := &clientcmd.ConfigOverrides{}
	if g.namespace != "" {
		overrides.Context.Namespace = g.namespace
	}
	return clientcmd.NewDefaultClientConfig(clientcmdapi.Config{}, overrides)
}
