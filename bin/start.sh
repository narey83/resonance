#!/usr/bin/env bash

echo "Starting resonance services..."
systemctl --user start resonance-backend resonance-frontend
systemctl --user status resonance-backend resonance-frontend --no-pager
