interface AssetFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
}

interface Env {
  ASSETS: AssetFetcher
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request)
  },
}
