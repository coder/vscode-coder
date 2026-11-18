FROM mcr.microsoft.com/devcontainers/typescript-node:24-trixie@sha256:e1fd824e03c68d8f406ef45b574023a2d683a5acc98906743f8d60aaf78b0174

# VS Code/Electron share Chromium's native library requirements; playwright
# install-deps tracks that list upstream. Electron also requires libgtk-3-0t64
# which Playwright skips (its bundled Chromium doesn't use GTK).
# xvfb enables headless test runs.
RUN npx --yes playwright install-deps chromium && \
	apt-get update && \
	apt-get install --yes --no-install-recommends libgtk-3-0t64 xauth xvfb && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/* /root/.npm
