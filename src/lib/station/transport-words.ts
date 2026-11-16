// What the station calls its message transport in user-visible text.
//   "relay"         the local relay process (two-end integration, ?relay=…)
//   "browser-demo"  the in-browser bus of the online demo (/demo): same rules, inside this tab
// In the browser demo a "send" is accepted by an in-page bus, never by a remote server or a real
// device, so the wording must say so. Set once by the station shell from its link mode.
export type TransportMode = "relay" | "browser-demo";
let mode: TransportMode = "relay";
export const setTransportMode = (m: TransportMode) => {
  mode = m;
};
export const transportMode = () => mode;
/** "relay" / "in-browser bus" (mid-sentence). */
export const busName = () => (mode === "browser-demo" ? "in-browser bus" : "relay");
/** "Relay" / "In-browser bus" (start of a sentence or label). */
export const BusName = () => (mode === "browser-demo" ? "In-browser bus" : "Relay");
