package services

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"
)

// ErrDisallowedHost is returned when an outbound URL is not on the allowlist.
var ErrDisallowedHost = errors.New("host not allowed")

// isPublicIP reports whether ip is a globally routable unicast address.
func isPublicIP(ip net.IP) bool {
	if ip == nil {
		return false
	}
	return !(ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() ||
		ip.IsInterfaceLocalMulticast() ||
		// 100.64.0.0/10 carrier-grade NAT
		(ip.To4() != nil && ip.To4()[0] == 100 && ip.To4()[1]&0xc0 == 64))
}

// safeDialControl blocks connections to non-public addresses. It runs after DNS
// resolution, so it also defeats DNS rebinding to internal IPs.
func safeDialControl(network, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	if !isPublicIP(net.ParseIP(host)) {
		return fmt.Errorf("refusing to connect to non-public address %s", host)
	}
	return nil
}

// newSafeClient returns an HTTP client that only talks to public IPs and only
// follows redirects to hosts accepted by allowHost (nil = any public host).
func newSafeClient(timeout time.Duration, allowHost func(string) bool) *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: safeDialControl}
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: timeout,
		MaxIdleConns:          20,
		IdleConnTimeout:       60 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "https" {
				return ErrDisallowedHost
			}
			if allowHost != nil && !allowHost(req.URL.Hostname()) {
				return ErrDisallowedHost
			}
			return nil
		},
	}
}

// hostAllowlist builds a matcher for exact hosts.
func hostAllowlist(hosts ...string) func(string) bool {
	set := make(map[string]bool, len(hosts))
	for _, h := range hosts {
		set[strings.ToLower(h)] = true
	}
	return func(h string) bool { return set[strings.ToLower(h)] }
}

// parseAllowedURL parses raw and checks it is https on an allowed host.
func parseAllowedURL(raw string, allow func(string) bool) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("invalid URL")
	}
	if u.Scheme != "https" || u.User != nil || !allow(u.Hostname()) || (u.Port() != "" && u.Port() != "443") {
		return nil, ErrDisallowedHost
	}
	return u, nil
}

// Shared clients. apiClient is for fixed third-party API hosts; musicClient is
// restricted to Spotify/YouTube hosts because it fetches user-supplied URLs.
var (
	apiClient = newSafeClient(8*time.Second, nil)

	musicHosts  = hostAllowlist("open.spotify.com", "spotify.com", "www.youtube.com", "youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be")
	musicClient = newSafeClient(8*time.Second, musicHosts)
)

// APIClient returns the shared public-IP-only client for fixed upstream hosts.
func APIClient() *http.Client { return apiClient }
