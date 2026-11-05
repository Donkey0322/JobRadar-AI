/**
 * Patch for the pnpm spec Easy Complete 2.5.0 actually loads:
 * ~/Library/Application Support/fig/autocomplete/specs/pnpm.js
 *
 * Upstream source: https://github.com/withfig/autocomplete/blob/master/src/pnpm.ts
 * The installed file is that spec bundled with `npmScriptsGenerator` from
 * https://github.com/withfig/autocomplete/blob/master/src/npm.ts
 *
 * `pnpm <script>` reads the nearest package.json in the script generator and
 * copies `fig[script]` onto that suggestion. The script argument is variadic
 * and has no `isCommand` or `isScript`. The parser only follows `loadSpec`
 * when it is set on the argument or subcommand that just accepted the token
 * (`b_` in the autocomplete bundle). A `loadSpec` function cannot return
 * "keep the current spec": `b_` throws on null and otherwise replaces the spec.
 * Scripts without `fig` would stop listing scripts.
 *
 * `generateSpec` is the supported extension. The parser merges its subcommands
 * before consuming the next token (`tb`), then enters a matching name before
 * it can be consumed as a script argument (`Wy` before `qy`). This patch keeps
 * the existing node-CLI `loadSpec` behavior and adds each `fig` entry that
 * belongs to a real script and declares subcommands or options.
 *
 * Apply it to a copy of the installed spec. Point Easy Complete's developer
 * spec folder at that copy. Do not replace the .app, the user spec cache, or
 * shell rc files.
 *
 *   ec settings autocomplete.developerModeNPM true
 *   ec settings autocomplete.devCompletionsFolder <directory containing pnpm.js>
 *
 * The parser check is opt-in and is not part of `pnpm test`:
 *
 *   EASY_COMPLETE_BUNDLE=<autocomplete bundle> \
 *   EASY_COMPLETE_PNPM_SPEC=<pnpm.js the app loads> \
 *   pnpm exec vitest run --config vitest.integration.config.mjs
 */

const INSTALLED_GENERATE_SPEC =
  'generateSpec:async(e,n)=>{let{script:t,postProcess:i}=f;return{name:"pnpm",subcommands:i((await n({command:t[0],args:t.slice(1)})).stdout,e).map(({name:s})=>s).filter(s=>R.has(s)).map(s=>({name:s,loadSpec:s,icon:"fig://icon?type=package"}))}';

const PATCHED_GENERATE_SPEC = `generateSpec:async(e,n)=>{let{script:t,postProcess:i}=f;let subcommands=[];try{subcommands=i((await n({command:t[0],args:t.slice(1)})).stdout,e).map(({name:s})=>s).filter(s=>R.has(s)).map(s=>({name:s,loadSpec:s,icon:"fig://icon?type=package"}))}catch{}try{const out=await n({command:"bash",args:["-c","until [[ -f package.json ]] || [[ $PWD = '/' ]]; do cd ..; done; cat package.json"]});const pkg=JSON.parse(out.stdout);const scripts=pkg.scripts||{};const fig=pkg.fig||{};for(const [name,spec] of Object.entries(fig)){if(typeof scripts[name]!=="string"||!spec||typeof spec!=="object")continue;if(!spec.subcommands&&!spec.options)continue;subcommands.push({name,description:scripts[name],...spec})}}catch{}return{name:"pnpm",subcommands}`;

export function patchInstalledPnpmSpec(source: string) {
  const count = source.split(INSTALLED_GENERATE_SPEC).length - 1;

  if (count !== 1) {
    throw new Error(`Installed pnpm generateSpec was found ${count} times`);
  }

  return source.replace(INSTALLED_GENERATE_SPEC, PATCHED_GENERATE_SPEC);
}
