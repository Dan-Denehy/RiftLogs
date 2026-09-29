// Reuse the spectator's login and room joining; select the separate research recorder.
export {};
process.env.RIFTLOGS_FULL_CAPTURE = "1";
await import("./spectator-probe.ts");
