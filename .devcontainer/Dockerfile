FROM mcr.microsoft.com/devcontainers/typescript-node:22-bookworm@sha256:7653612ebf9384fa1cbd32413d8f4fbf7daaf24e39e8664d9fc030de8c0c0af2

# VS Code/Electron share Chromium's native library requirements; playwright
# install-deps tracks that list upstream. xvfb enables headless test runs.
RUN npx --yes playwright install-deps chromium && \
	apt-get update && \
	apt-get install --yes --no-install-recommends xvfb && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/* /root/.npm
