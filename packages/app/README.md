# @driftbox/app

Driftbox — a drum machine and step sequencer in the browser. A TR-808, a TR-909 and two
TB-303s, all synthesised from scratch, with a chillwave visualiser and an oscilloscope.

```bash
npx @driftbox/app
```

That serves the app on `http://127.0.0.1:4173` and opens it. Nothing is uploaded anywhere
— your work is saved in the browser, on your machine.

```
  -p, --port <number>   Port to listen on (default 4173, or $PORT)
      --host <address>  Address to bind (default 127.0.0.1)
      --no-open         Do not open a browser
```

**No runtime dependencies.** What ships is a prebuilt bundle and a server written against
Node built-ins, so `npx` fetches one small tarball and runs it rather than resolving React,
three and the rest first.

Or use it without installing anything, at
[emmettl.github.io/driftbox](https://emmettl.github.io/driftbox/).

## Using it

Space plays and stops · `V` drops into performance mode · `X` switches the scope between a
waveform and a vectorscope · click a step to cycle it off → on → accented · on the 303
page, click a step to place a note and drag it up or down to tune it.

The **Song** strip along the top is the arrangement — each card is a pattern and a number
of bars, and it can be rearranged while the thing is playing.

**share** puts the whole song in a link, **save** and **load** move it to and from a file,
and **reset** goes back to the shipped patterns.

## The synthesis

Everything audible comes from [`@driftbox/engine`](https://www.npmjs.com/package/@driftbox/engine),
which is published separately and can be embedded in your own project.

## Licence

[MIT](../../LICENSE). Not affiliated with, endorsed by, or connected to Roland Corporation.
