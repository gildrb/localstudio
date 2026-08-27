export function createSerialAccess() {
  let tail = Promise.resolve();
  return <A>(operation: () => Promise<A>): Promise<A> => {
    const result = tail.then(operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
