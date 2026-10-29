// SPDX-License-Identifier: AGPL-3.0-only
package main

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"time"
)

type resonanceStreamReader struct {
	connection connection
	files      map[string]remoteFile
	client     *http.Client
}

func newResonanceStreamReader(c connection, files map[string]remoteFile) *resonanceStreamReader {
	return &resonanceStreamReader{connection: c, files: files, client: &http.Client{
		Timeout:       30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("stream redirects are not allowed") },
	}}
}

func (r *resonanceStreamReader) Stat(path string) (int64, time.Time, bool) {
	file, ok := r.files[filepath.Clean(path)]
	return file.Bytes, time.Unix(0, 0), ok
}

func (r *resonanceStreamReader) ReadAt(path string, offset, count uint32) ([]byte, error) {
	file, ok := r.files[filepath.Clean(path)]
	if !ok {
		return nil, errors.New("unknown streamed track")
	}
	if int64(offset) >= file.Bytes || count == 0 {
		return []byte{}, nil
	}
	end := int64(offset) + int64(count) - 1
	if end >= file.Bytes {
		end = file.Bytes - 1
	}
	endpoint := r.connection.ServerURL + "/audio/" + url.PathEscape(file.SourceKey)
	req, err := http.NewRequest("GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Resonance-Link-Token", r.connection.Token)
	req.Header.Set("Range", fmt.Sprintf("bytes=%d-%d", offset, end))
	response, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusPartialContent {
		return nil, fmt.Errorf("Resonance stream returned HTTP %d", response.StatusCode)
	}
	wanted := end - int64(offset) + 1
	data, err := io.ReadAll(io.LimitReader(response.Body, wanted+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != wanted {
		return nil, errors.New("short or oversized Resonance range response")
	}
	return data, nil
}
