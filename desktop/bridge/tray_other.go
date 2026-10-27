//go:build !windows && !linux

// SPDX-License-Identifier: AGPL-3.0-only
package main

import "context"

func runDesktop(ctx context.Context, h *helper, address string) { <-ctx.Done() }
