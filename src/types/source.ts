interface Source {
  name: string;
  url: string;
  format: "markdown" | "html";
  type: "summer" | "off-season" | "new-grad";
}

export default Source;
