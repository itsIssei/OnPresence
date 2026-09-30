package api

import (
	"sync"
	"time"
)

// failLimiter counts failures per key inside a sliding window.
type failLimiter struct {
	mu     sync.Mutex
	window time.Duration
	max    int
	hits   map[string][]time.Time
}

func newFailLimiter(max int, window time.Duration) *failLimiter {
	return &failLimiter{max: max, window: window, hits: map[string][]time.Time{}}
}

func (l *failLimiter) prune(key string, now time.Time) []time.Time {
	list := l.hits[key]
	i := 0
	for i < len(list) && now.Sub(list[i]) > l.window {
		i++
	}
	list = list[i:]
	if len(list) == 0 {
		delete(l.hits, key)
	} else {
		l.hits[key] = list
	}
	return list
}

// Blocked reports whether key reached the limit.
func (l *failLimiter) Blocked(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key, time.Now())) >= l.max
}

func (l *failLimiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.hits[key] = append(l.prune(key, now), now)
}

func (l *failLimiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

// Sweep drops expired keys; call periodically.
func (l *failLimiter) Sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for k := range l.hits {
		l.prune(k, now)
	}
}

// seenSet remembers keys for ttl (used to count one profile view per visitor).
type seenSet struct {
	mu   sync.Mutex
	ttl  time.Duration
	seen map[string]time.Time
}

func newSeenSet(ttl time.Duration) *seenSet {
	return &seenSet{ttl: ttl, seen: map[string]time.Time{}}
}

// Add returns true if key was not seen within ttl.
func (s *seenSet) Add(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if t, ok := s.seen[key]; ok && now.Sub(t) < s.ttl {
		return false
	}
	if len(s.seen) > 50000 {
		for k, t := range s.seen {
			if now.Sub(t) >= s.ttl {
				delete(s.seen, k)
			}
		}
	}
	s.seen[key] = now
	return true
}
