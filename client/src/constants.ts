// Shared with the proxy by value, not by import: server/config.ts is a Node module that
// reads dotenv at load, so importing it into the browser bundle would pull in the
// environment. These two numbers are the audio contract and change together or not at all.
export const SAMPLE_RATE = 16_000;
