#!/bin/sh
# harden-tv.sh — privacy hardening for a rooted retail Tizen TV.
#
# Run on the TV through the root daemon:
#   samsung-tv-root execute my-tv "$(cat tools/harden-tv.sh)" --timeout 60
# or stage it first:
#   sdb push tools/harden-tv.sh /home/owner/share/tmp/harden-tv.sh
#   samsung-tv-root execute my-tv "sh /home/owner/share/tmp/harden-tv.sh"
#
# Every step is idempotent and best-effort: the script reports what it changed
# and what it could not find. Volatile root does not guarantee that hosts,
# package, or configuration changes revert on power loss. Review the changes
# before running; this script does not provide a complete backup or rollback.

set -u

MARK_BEGIN="# samsung-tv-root hardening begin"
MARK_END="# samsung-tv-root hardening end"

echo "== samsung-tv-root hardening =="

# ---------------------------------------------------------------------------
# 1. Advertising, ACR (automatic content recognition), and telemetry sinkholes
# ---------------------------------------------------------------------------
# Domains are the union of the community Samsung TV blocklists. Hosts entries
# only affect on-TV lookups; router-side blocking is still recommended.

HOSTS_BLOCK="
0.0.0.0 samsungads.com
0.0.0.0 www.samsungads.com
0.0.0.0 config.samsungads.com
0.0.0.0 ad.samsungads.com
0.0.0.0 pm.samsungads.com
0.0.0.0 samsungacr.com
0.0.0.0 www.samsungacr.com
0.0.0.0 log-config.samsungacr.com
0.0.0.0 samsungcloudsolution.com
0.0.0.0 www.samsungcloudsolution.com
0.0.0.0 sas.samsungcloudsolution.com
0.0.0.0 oempprd.samsungcloudsolution.com
0.0.0.0 oempprd.samsungcloudsolution.net
0.0.0.0 notice.samsungcloudsolution.com
0.0.0.0 provision.samsungcloudsolution.com
0.0.0.0 noticefile.samsungcloudsolution.com
0.0.0.0 samsungotn.net
0.0.0.0 www.samsungotn.net
0.0.0.0 osb.samsungqbe.com
0.0.0.0 osb-secure.samsungqbe.com
0.0.0.0 gpm.samsungqbe.com
0.0.0.0 log-ingestion-eu.samsungacr.com
0.0.0.0 log-ingestion.samsungacr.com
"

if [ -w /etc/hosts ]; then
    if grep -qF "$MARK_BEGIN" /etc/hosts; then
        # Replace the previous managed block.
        TMP=$(mktemp /tmp/hosts.XXXXXX)
        sed "/$MARK_BEGIN/,/$MARK_END/d" /etc/hosts >"$TMP"
        cat "$TMP" >/etc/hosts
        rm -f "$TMP"
    fi
    {
        echo "$MARK_BEGIN"
        echo "$HOSTS_BLOCK" | grep -v '^$'
        echo "$MARK_END"
    } >>/etc/hosts
    echo "[hosts] ad/telemetry sinkhole block installed in /etc/hosts"
else
    echo "[hosts] /etc/hosts is not writable; skipping sinkhole block"
fi

# ---------------------------------------------------------------------------
# 2. Voice / always-on listening services
# ---------------------------------------------------------------------------
# Retail Tizen TVs ship several voice stacks: Bixby packages, the Voice
# Control Interface (vci) daemon, and wake-word components. Names vary by
# Tizen version; kill whatever is present and report what was found.

VOICE_PROCS="
voice
bixby
vci
seamless-update
wakeup
audioserver_mic
"

killed=0
for pattern in $VOICE_PROCS; do
    for pid in $(ps 2>/dev/null | grep -i "$pattern" | grep -v grep | awk '{print $1}'); do
        if kill "$pid" 2>/dev/null; then
            echo "[voice] stopped pid $pid ($pattern)"
            killed=$((killed + 1))
        fi
    done
done
if [ "$killed" -eq 0 ]; then
    echo "[voice] no matching voice processes found (nothing to stop)"
fi

# Disable voice packages when the package manager supports it. On Tizen 8
# pkgcmd uses -D/--deactivate to disable a package (rollback: pkgcmd -A);
# lowercase -d is --descriptor, an unrelated query flag. Absence of a
# package is not an error.
if command -v pkgcmd >/dev/null 2>&1; then
    for pkg in $(pkginfo --listpkg 2>/dev/null | tr -d '[]' | tr ',' '\n' |
        grep -iE 'bixby|voice|alexa|googleassistant'); do
        if pkgcmd -D "$pkg" >/dev/null 2>&1; then
            echo "[voice] disabled package $pkg"
        else
            echo "[voice] found package $pkg (pkgcmd -D not supported; left installed)"
        fi
    done
fi

# Microphone permission revocation for the voice stack via vconf when present.
if command -v vconftool >/dev/null 2>&1; then
    for key in db/private/voice/enabled memory/private/voice/wakeup; do
        if vconftool get "$key" >/dev/null 2>&1; then
            vconftool set -t int "$key" 0 >/dev/null 2>&1 &&
                echo "[voice] vconf $key -> 0"
        fi
    done
fi

# ---------------------------------------------------------------------------
# 3. Telemetry and crash reporting daemons
# ---------------------------------------------------------------------------

for pattern in dlog crash samsung-analytics diagnostics coredump; do
    for pid in $(ps 2>/dev/null | grep -i "$pattern" | grep -v grep | awk '{print $1}'); do
        if kill "$pid" 2>/dev/null; then
            echo "[telemetry] stopped pid $pid ($pattern)"
        fi
    done
done

# Deactivate the ad/ACR/telemetry/voice packages the user approved. pkgcmd -D
# is the Tizen 8 deactivate flag (rollback: pkgcmd -A <pkg>); only packages
# on the approved list are touched — names absent on this build are skipped.
if command -v pkgcmd >/dev/null 2>&1; then
    for pkg in \
        com.samsung.tv.acr-service-app \
        com.samsung.tv.adplayer \
        adplatform \
        com.samsung.tv.targeted-ad-service \
        com.samsung.tv.coba.adagent \
        com.samsung.tizen.samsung-analytics \
        com.samsung.tv.farfieldvoice; do
        if pkgcmd -D "$pkg" >/dev/null 2>&1; then
            echo "[packages] deactivated $pkg"
        else
            echo "[packages] $pkg not present or deactivate unsupported (skipped)"
        fi
    done
    # Wake-word engine package names vary by build; deactivate whatever exists.
    for pkg in $(pkginfo --listpkg 2>/dev/null | tr -d '[]' | tr ',' '\n' |
        grep -i 'wakeup-engine'); do
        if pkgcmd -D "$pkg" >/dev/null 2>&1; then
            echo "[packages] deactivated $pkg"
        fi
    done
fi

# ---------------------------------------------------------------------------
# 4. Audit summary — what is still installed
# ---------------------------------------------------------------------------

echo "-- installed packages matching voice/ad/acr --"
if command -v pkginfo >/dev/null 2>&1; then
    pkginfo --listpkg 2>/dev/null | tr -d '[]' | tr ',' '\n' |
        grep -iE 'bixby|voice|acr|ads?\.|adhub|track' || echo "  (none)"
else
    echo "  pkginfo unavailable"
fi

echo "== hardening pass complete =="
