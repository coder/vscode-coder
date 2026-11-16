#!/bin/bash
# Write release-digests.json: the SHA-256 digest of every Coder CLI binary that
# deployments serve from /bin, for each coder/coder release since MIN_VERSION.
#
# The extension trusts these digests for releases that have no signature from
# the current release key, so they come only from release archives checked
# against a GitHub attestation, never from a deployment, releases.coder.com or
# an .asc signature. Each release's linux_amd64 archive must have one of:
#   - build provenance from coder/coder's release.yaml, run on that release's
#     tag or release branch, for a commit on the release branch; or
#   - GitHub's attestation of the immutable release asset.
# The server binary in that archive embeds the CLI binaries for every platform,
# which are extracted and hashed. Releases that fail both checks are left out and
# listed at the end.
#
# Requires gh (authenticated), jq, curl, tar, zstd and sha256sum.
#
# Usage: ./scripts/generate-release-digests.sh [MIN_VERSION] > release-digests.json
# Example: ./scripts/generate-release-digests.sh 2.29.0 > release-digests.json

set -euo pipefail

MIN_VERSION="${1:-2.29.0}"
REPO=coder/coder

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

log() { echo "$*" >&2; }

# Prints the release's verified commit, or fails.
verify_archive() {
	local tag="$1" file="$2" minor="$3" result ref commit status
	if result="$(gh attestation verify "$file" --repo "$REPO" \
		--signer-workflow "$REPO/.github/workflows/release.yaml" --format json 2>/dev/null)"; then
		ref="$(jq -r '.[0].verificationResult.signature.certificate.sourceRepositoryRef' <<<"$result")"
		commit="$(jq -r '.[0].verificationResult.signature.certificate.sourceRepositoryDigest' <<<"$result")"
		if [[ "$ref" != "refs/tags/$tag" && "$ref" != "refs/heads/release/$minor" ]]; then
			log "$tag: provenance is for $ref, not $tag or release/$minor"
			return 1
		fi
		status="$(gh api "repos/$REPO/compare/$commit...release/$minor" --jq .status 2>/dev/null || echo missing)"
		if [[ "$status" != "identical" && "$status" != "ahead" ]]; then
			log "$tag: provenance commit $commit is not on release/$minor ($status)"
			return 1
		fi
		echo "provenance $commit"
		return 0
	fi
	if gh release verify-asset "$tag" "$file" --repo "$REPO" >/dev/null 2>&1; then
		echo "release-asset"
		return 0
	fi
	return 1
}

# Prints "<name> <sha256>" for each CLI binary embedded in a server binary.
embedded_digests() {
	local server="$1" out="$2" offset files
	mkdir -p "$out"
	# The binaries are a zstd-compressed tar embedded in the server binary; try
	# each zstd frame until one is a tar of coder-* files.
	for offset in $(LC_ALL=C grep -obUaP '\x28\xb5\x2f\xfd' "$server" | cut -d: -f1); do
		files="$(tail -c +"$((offset + 1))" "$server" | zstd -dcq 2>/dev/null | tar -t 2>/dev/null || true)"
		if grep -qx 'coder-linux-amd64' <<<"$files"; then
			tail -c +"$((offset + 1))" "$server" | zstd -dcq 2>/dev/null | tar -x -C "$out" 2>/dev/null || true
			break
		fi
	done
	(cd "$out" && find . -maxdepth 1 -type f -name 'coder-*' ! -name '*.asc' -printf '%f\n' | sort | while read -r name; do
		echo "$name $(sha256sum "$name" | cut -d' ' -f1)"
	done)
}

tags="$(gh release list --repo "$REPO" --limit 1000 --exclude-pre-releases --json tagName --jq '.[].tagName' |
	grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V |
	awk -v min="v$MIN_VERSION" 'BEGIN { split(substr(min, 2), m, ".") } { split(substr($0, 2), v, "."); if (v[1] > m[1] || (v[1] == m[1] && (v[2] > m[2] || (v[2] == m[2] && v[3] >= m[3])))) print }')"

digests='{}'
skipped=()
for tag in $tags; do
	version="${tag#v}"
	minor="${version%.*}"
	dir="$work/$version"
	mkdir -p "$dir"
	archive="coder_${version}_linux_amd64.tar.gz"
	if ! gh release download "$tag" --repo "$REPO" --pattern "$archive" --dir "$dir" >/dev/null 2>&1; then
		log "$tag: no $archive"
		skipped+=("$tag")
		continue
	fi
	if ! how="$(verify_archive "$tag" "$dir/$archive" "$minor")"; then
		log "$tag: no attestation verifies $archive"
		skipped+=("$tag")
		rm -rf "$dir"
		continue
	fi
	tar -xzf "$dir/$archive" -C "$dir"
	entries="$(embedded_digests "$dir/coder" "$dir/bin")"
	if ! grep -q '^coder-linux-amd64 ' <<<"$entries"; then
		log "$tag: no CLI binaries found in the server binary"
		skipped+=("$tag")
		rm -rf "$dir"
		continue
	fi
	digests="$(jq --arg v "$version" --arg e "$entries" \
		'.[$v] = ($e | split("\n") | map(select(length > 0) | split(" ") | {(.[0]): .[1]}) | add)' <<<"$digests")"
	log "$tag: $(wc -l <<<"$entries") binaries ($how)"
	rm -rf "$dir"
done

jq --sort-keys . <<<"$digests"
if ((${#skipped[@]})); then
	log "Not included (no verifiable attestation): ${skipped[*]}"
fi
