package services

import (
	"sync"
	"time"
)

// Cache is a small TTL cache with per-key request coalescing: concurrent
// callers for the same key share one upstream fetch.
type Cache[T any] struct {
	ttl     time.Duration
	mu      sync.Mutex
	entries map[string]*cacheEntry[T]
}

type cacheEntry[T any] struct {
	mu      sync.Mutex
	value   T
	err     error
	fetched time.Time
}

func NewCache[T any](ttl time.Duration) *Cache[T] {
	return &Cache[T]{ttl: ttl, entries: map[string]*cacheEntry[T]{}}
}

// Get returns the cached value for key, calling fetch when missing or stale.
// Errors are cached for a quarter of the TTL to avoid hammering a failing API.
func (c *Cache[T]) Get(key string, fetch func() (T, error)) (T, error) {
	c.mu.Lock()
	e, ok := c.entries[key]
	if !ok {
		if len(c.entries) > 1000 { // keys come from config, but stay bounded anyway
			c.entries = map[string]*cacheEntry[T]{}
		}
		e = &cacheEntry[T]{}
		c.entries[key] = e
	}
	c.mu.Unlock()

	e.mu.Lock()
	defer e.mu.Unlock()
	ttl := c.ttl
	if e.err != nil {
		ttl /= 4
	}
	if !e.fetched.IsZero() && time.Since(e.fetched) < ttl {
		return e.value, e.err
	}
	e.value, e.err = fetch()
	e.fetched = time.Now()
	return e.value, e.err
}
