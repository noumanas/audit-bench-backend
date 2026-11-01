import { fetchWithRetry } from './github.service';

describe('fetchWithRetry', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  const respond = (status: number) => new Response(status === 200 ? 'ok' : 'err', { status });
  const run = async (promise: Promise<Response>) => {
    await jest.runAllTimersAsync();
    return promise;
  };

  beforeEach(() => jest.useFakeTimers());

  it('retries a dropped connection and returns the next response', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(respond(200));
    global.fetch = fetchMock;
    const res = await run(fetchWithRetry('https://api.github.com/x', {}));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx and 429 but not other errors', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(respond(502)).mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));
    expect((await run(fetchWithRetry('u', {}))).status).toBe(200);

    const notFound = jest.fn().mockResolvedValue(respond(404));
    global.fetch = notFound;
    expect((await run(fetchWithRetry('u', {}))).status).toBe(404);
    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last attempt', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = fetchMock;
    const result = fetchWithRetry('u', {}, 3).catch((e: Error) => e);
    await jest.runAllTimersAsync();
    expect(await result).toBeInstanceOf(TypeError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
