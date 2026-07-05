import { register } from 'node:module'

register(new URL('./loader-resolver.mjs', import.meta.url))
