declare module 'lz-string' {
  const lzString: {
    compressToUint8Array(uncompressed: string): Uint8Array
    decompressFromUint8Array(compressed: Uint8Array): string
  }
  export default lzString
}
