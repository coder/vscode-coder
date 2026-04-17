FROM mcr.microsoft.com/devcontainers/typescript-node:24-bookworm@sha256:7958dd7e6fe4242fce6ba4f57b9de561ea82233d5542921b5335d435c2c78791

# Electron and VS Code need the same native libraries as Chromium to run
# integration tests. Playwright's install-deps maintains that list upstream.
# xvfb provides a virtual X display for headless test execution.
RUN npx --yes playwright install-deps chromium && \
	apt-get install --yes --no-install-recommends xvfb && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/* /root/.npm
