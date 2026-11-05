#!/usr/bin/env bash
# Sample the Pi power flags for N seconds (default 30), twice a second, and count kernel undervoltage events. Run on the Pi.
#   ~/peak/node/powerwatch.sh [seconds]
# undervoltage_now counts samples with bit 0 of vcgencmd get_throttled set; throttled counts bit 2.
N=${1:-30}; start=$(date "+%Y-%m-%d %H:%M:%S"); uv=0; cap=0; thr=0; n=0; fmin=9999; fmax=0
end=$((SECONDS + N))
while [ $SECONDS -lt $end ]; do
  t=$(vcgencmd get_throttled | cut -d= -f2); f=$(( $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq) / 1000 ))
  n=$((n+1)); [ $((t & 1)) -ne 0 ] && uv=$((uv+1)); [ $((t & 2)) -ne 0 ] && cap=$((cap+1)); [ $((t & 4)) -ne 0 ] && thr=$((thr+1))
  [ $f -lt $fmin ] && fmin=$f; [ $f -gt $fmax ] && fmax=$f
  sleep 0.5
done
ev=$(journalctl -k --since "$start" --no-pager 2>/dev/null | grep -ci "undervoltage detected")
echo "samples=$n undervoltage_now=$uv freq_capped=$cap throttled=$thr cpu_mhz=$fmin-$fmax kernel_dips=$ev temp=$(vcgencmd measure_temp | cut -d= -f2) flags=$(vcgencmd get_throttled | cut -d= -f2) load=$(cut -d" " -f1 /proc/loadavg)"
