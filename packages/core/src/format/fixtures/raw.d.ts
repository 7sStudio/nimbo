// Lets tests import a .jsnb fixture as text through Vite's ?raw query.
declare module "*.jsnb?raw" {
  const text: string;
  export default text;
}
