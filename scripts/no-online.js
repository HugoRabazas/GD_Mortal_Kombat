// Stands in for the online library in the Artifact build, which has no network.
export function createClient() {
  throw new Error('Online play is not part of this build.');
}
