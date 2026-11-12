// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"container/list"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"sync"
	"time"
)

const relayBlockSize int64 = 512 << 10
const relayCacheLimit = 32 << 20

type relayBlockKey struct {
	path   string
	offset int64
}

type relayBlock struct {
	ready   chan struct{}
	data    []byte
	err     error
	element *list.Element
}

type resonanceStreamReader struct {
	connection connection
	files      map[string]remoteFile
	client     *http.Client
	mu         sync.Mutex
	blocks     map[relayBlockKey]*relayBlock
	lru        *list.List
	cached     int
}

func newResonanceStreamReader(c connection, files map[string]remoteFile) *resonanceStreamReader {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = 16
	return &resonanceStreamReader{connection: c, files: files, client: &http.Client{
		Timeout:       30 * time.Second,
		Transport:     transport,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("stream redirects are not allowed") },
	}, blocks: make(map[relayBlockKey]*relayBlock), lru: list.New()}
}

func (r *resonanceStreamReader) Stat(path string) (int64, time.Time, bool) {
	file, ok := r.files[filepath.Clean(path)]
	return file.Bytes, time.Unix(0, 0), ok
}

func (r *resonanceStreamReader) ReadAt(path string, offset, count uint32) ([]byte, error) {
	path = filepath.Clean(path)
	file, ok := r.files[path]
	if !ok {
		return nil, errors.New("unknown streamed track")
	}
	if int64(offset) >= file.Bytes || count == 0 {
		return []byte{}, nil
	}
	wanted := min(int64(count), file.Bytes-int64(offset))
	result := make([]byte, int(wanted))
	for position, copied := int64(offset), 0; copied < len(result); {
		start := position / relayBlockSize * relayBlockSize
		block, err := r.readBlock(path, file, start)
		if err != nil {
			return nil, err
		}
		n := copy(result[copied:], block[position-start:])
		if n == 0 {
			return nil, errors.New("empty Resonance range response")
		}
		copied += n
		position += int64(n)
	}
	return result, nil
}

func (r *resonanceStreamReader) readBlock(path string, file remoteFile, start int64) ([]byte, error) {
	key := relayBlockKey{path: path, offset: start}
	r.mu.Lock()
	if block, ok := r.blocks[key]; ok {
		if block.element != nil {
			r.lru.MoveToFront(block.element)
		}
		r.mu.Unlock()
		<-block.ready
		return block.data, block.err
	}
	block := &relayBlock{ready: make(chan struct{})}
	r.blocks[key] = block
	r.mu.Unlock()

	data, err := r.fetchBlock(file, start)
	r.mu.Lock()
	block.data, block.err = data, err
	if err != nil {
		delete(r.blocks, key)
	} else {
		block.element = r.lru.PushFront(key)
		r.cached += len(data)
		for r.cached > relayCacheLimit {
			oldest := r.lru.Back()
			oldKey := oldest.Value.(relayBlockKey)
			r.cached -= len(r.blocks[oldKey].data)
			delete(r.blocks, oldKey)
			r.lru.Remove(oldest)
		}
	}
	close(block.ready)
	r.mu.Unlock()
	return data, err
}

func (r *resonanceStreamReader) fetchBlock(file remoteFile, start int64) ([]byte, error) {
	end := min(start+relayBlockSize, file.Bytes) - 1
	endpoint := r.connection.ServerURL + "/audio/" + url.PathEscape(file.SourceKey)
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Resonance-Link-Token", r.connection.Token)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", start, end))
	response, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusPartialContent {
		return nil, fmt.Errorf("Resonance stream returned HTTP %d", response.StatusCode)
	}
	if response.Header.Get("Content-Range") != fmt.Sprintf("bytes %d-%d/%d", start, end, file.Bytes) {
		return nil, errors.New("Resonance stream returned an unexpected range")
	}
	wanted := end - start + 1
	data, err := io.ReadAll(io.LimitReader(response.Body, wanted+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != wanted {
		return nil, errors.New("short or oversized Resonance range response")
	}
	return data, nil
}
