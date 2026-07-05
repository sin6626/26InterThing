import { resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const srcDir = pathResolve(__dirname, '..', 'src') + '/'

export function resolve(specifier, context, nextResolve) {
  if (specifier === '@/utils/request') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,' + encodeURIComponent(
        `const request = { defaults: { baseURL: 'http://localhost:3000' } }; export default request;`
      ),
    }
  }
  if (specifier.startsWith('@/')) {
    const mapped = specifier.replace('@/', srcDir)
    return nextResolve(mapped, context)
  }
  return nextResolve(specifier, context)
}
