[![Read broken CSV files faster](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/harrierme/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/harrierme/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader, faster

A drop-in for csv-reader 1.0.0 that answers exactly as it does on every input, in less CPU time. `solve.js` exports `run(input)`, which reads one case's `{text, header}` and returns `{columns, rows, errors}`; `main.ts` is the program the harness runs, reading every case from `/input/cases.json` and writing `/output/answers.json`.

## How it is faster

The reference reads one character at a time and grows every field a character at a time. This one jumps from one interesting character to the next instead:

- In an unquoted field, a regex finds the next comma, CR or LF, and the run between them is cut out with one `slice`.
- In a quoted field, `indexOf` finds the next quote (doubled quotes folded in as one literal quote), and each span is cut out whole; only a span holding a CR or LF goes through the normaliser that turns CRLF and lone CR into LF.
- A line with no quote and no stray CR is cut out whole and split on commas in one native call.

Nothing is cached from one case to the next: every case is read alone, from the first character.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=path/to/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22 or later, standard library only. No install, no network, no WebAssembly, no native addon.
