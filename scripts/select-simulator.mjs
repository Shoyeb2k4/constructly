/**
 * Pick an iOS Simulator to validate against, from whatever the runner actually has.
 *
 * Hardcoding a device name ("iPhone 15") or a UDID is how simulator CI rots:
 * GitHub rotates the macOS image and Xcode drops old device types, so a literal
 * name silently becomes "device not found" months later. This enumerates what is
 * installed and chooses, so the workflow keeps working across image updates.
 *
 * Selection rules:
 *   - iOS runtimes only, at or above the app's deployment target
 *   - newest runtime wins
 *   - iPhone devices only (this is a phone app; iPad layout is not in scope)
 *   - prefer a plain "iPhone <n>", then "iPhone <n> Pro", then any iPhone,
 *     always highest model number — plain models are the most representative
 *     and least likely to be a niche form factor
 *
 * Writes name/udid/runtime to $GITHUB_OUTPUT when present, and always prints the
 * choice so the run log records exactly what was validated.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const MIN_IOS = [15, 0]; // must match IPHONEOS_DEPLOYMENT_TARGET

function parseVersion(text) {
  const m = /(\d+)[.-](\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function atLeast(v, min) {
  return v[0] > min[0] || (v[0] === min[0] && v[1] >= min[1]);
}

/** Rank an iPhone name: higher is better. */
function rankDevice(name) {
  const model = Number(/iPhone\s+(\d+)/.exec(name)?.[1] ?? 0);
  let tier = 0;
  if (/^iPhone\s+\d+$/.test(name)) tier = 3; // plain
  else if (/^iPhone\s+\d+\s+Pro$/.test(name)) tier = 2;
  else if (/^iPhone\s+\d+/.test(name)) tier = 1; // Pro Max / Plus / mini
  return model * 10 + tier;
}

const raw = execFileSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
  encoding: "utf8",
});
const { devices } = JSON.parse(raw);

const candidates = [];
for (const [runtimeId, list] of Object.entries(devices)) {
  if (!/iOS/i.test(runtimeId)) continue;
  const version = parseVersion(runtimeId);
  if (!version || !atLeast(version, MIN_IOS)) continue;

  for (const device of list) {
    if (device.isAvailable === false) continue;
    if (!/^iPhone/.test(device.name)) continue;
    candidates.push({
      name: device.name,
      udid: device.udid,
      runtime: `iOS ${version[0]}.${version[1]}`,
      version,
      rank: rankDevice(device.name),
    });
  }
}

if (candidates.length === 0) {
  console.error("No available iPhone simulator at or above iOS " + MIN_IOS.join("."));
  console.error("Runtimes seen: " + Object.keys(devices).join(", "));
  process.exitCode = 1;
} else {
  candidates.sort(
    (a, b) =>
      b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.rank - a.rank,
  );
  const pick = candidates[0];

  console.log(`Selected simulator: ${pick.name} (${pick.runtime})`);
  console.log(`UDID: ${pick.udid}`);
  console.log(`Considered ${candidates.length} available iPhone device(s).`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `name=${pick.name}\nudid=${pick.udid}\nruntime=${pick.runtime}\n`,
    );
  }
}
