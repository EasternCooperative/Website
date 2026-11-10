// The two `motion` functions scroll reveal uses, re-exported from a module of
// their own. scrollReveal.ts loads this file with a dynamic import(); importing
// 'motion' dynamically instead would pull in the library's whole namespace,
// because a bundler can't tree-shake a namespace object it has to hand back.
export { animate, scroll } from 'motion';
