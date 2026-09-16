FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie@sha256:cba90c28e53ac2f5a8a5a0388b71b8e98bbe1a4711e0faaa6ef48b137037d4ae

# VS Code/Electron share Chromium's native library requirements; playwright
# install-deps tracks that list upstream. Electron also requires libgtk-3-0t64
# which Playwright skips (its bundled Chromium doesn't use GTK).
# xvfb enables headless test runs.
RUN npx --yes playwright install-deps chromium && \
	apt-get update && \
	apt-get install --yes --no-install-recommends libgtk-3-0t64 xauth xvfb && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/* /root/.npm
