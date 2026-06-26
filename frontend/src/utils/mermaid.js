import mermaid from "mermaid";

export const MERMAID_DARK_VARS = {
  background: "#201D17",
  primaryColor: "#2A2620",
  primaryTextColor: "#EDE8DC",
  primaryBorderColor: "#C97C4A",
  lineColor: "#8A5536",
  secondaryColor: "#332E25",
  tertiaryColor: "#201D17",
  fontFamily: "JetBrains Mono, monospace",
};

export const MERMAID_LIGHT_VARS = {
  background: "#F7F3EC",
  primaryColor: "#EDE8DC",
  primaryTextColor: "#1A150C",
  primaryBorderColor: "#A05A28",
  lineColor: "#C87A44",
  secondaryColor: "#E2DAC8",
  tertiaryColor: "#EDE8DC",
  fontFamily: "JetBrains Mono, monospace",
};

mermaid.initialize({
  startOnLoad: false,
  theme: "dark",
  themeVariables: MERMAID_DARK_VARS,
});

export default mermaid;
