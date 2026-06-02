FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie@sha256:e36c918ec9c679c18451231e277ea9122c00a097fb6e4a23c8c3d35bf08bbc3a

# VS Code/Electron share Chromium's native library requirements; playwright
# install-deps tracks that list upstream. Electron also requires libgtk-3-0t64
# which Playwright skips (its bundled Chromium doesn't use GTK).
# xvfb enables headless test runs.
RUN npx --yes playwright install-deps chromium && \
	apt-get update && \
	apt-get install --yes --no-install-recommends libgtk-3-0t64 xauth xvfb && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/* /root/.npm
