export type ZipFile = {
  path: string
  data: string | Uint8Array
}

const textEncoder = new TextEncoder()

let crcTable: Uint32Array | null = null

const getCrcTable = () => {
  if (crcTable) {
    return crcTable
  }

  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1)
    }
    table[index] = value >>> 0
  }
  crcTable = table
  return table
}

const crc32 = (data: Uint8Array) => {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const createBuffer = (size: number) => {
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  return { bytes, view }
}

const dosDateTime = (date = new Date()) => {
  const year = Math.max(1980, date.getFullYear())
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

const normalizeData = (data: string | Uint8Array) => {
  return typeof data === 'string' ? textEncoder.encode(data) : data
}

const toBlobPart = (data: Uint8Array): BlobPart => {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

export const createZipBlob = (files: ZipFile[]) => {
  const chunks: Uint8Array[] = []
  const centralDirectory: Uint8Array[] = []
  const { dosTime, dosDate } = dosDateTime()
  let offset = 0

  for (const file of files) {
    const pathBytes = textEncoder.encode(file.path.replace(/\\/g, '/'))
    const data = normalizeData(file.data)
    const crc = crc32(data)

    const local = createBuffer(30)
    local.view.setUint32(0, 0x04034b50, true)
    local.view.setUint16(4, 20, true)
    local.view.setUint16(6, 0x0800, true)
    local.view.setUint16(8, 0, true)
    local.view.setUint16(10, dosTime, true)
    local.view.setUint16(12, dosDate, true)
    local.view.setUint32(14, crc, true)
    local.view.setUint32(18, data.byteLength, true)
    local.view.setUint32(22, data.byteLength, true)
    local.view.setUint16(26, pathBytes.byteLength, true)
    local.view.setUint16(28, 0, true)

    chunks.push(local.bytes, pathBytes, data)

    const central = createBuffer(46)
    central.view.setUint32(0, 0x02014b50, true)
    central.view.setUint16(4, 20, true)
    central.view.setUint16(6, 20, true)
    central.view.setUint16(8, 0x0800, true)
    central.view.setUint16(10, 0, true)
    central.view.setUint16(12, dosTime, true)
    central.view.setUint16(14, dosDate, true)
    central.view.setUint32(16, crc, true)
    central.view.setUint32(20, data.byteLength, true)
    central.view.setUint32(24, data.byteLength, true)
    central.view.setUint16(28, pathBytes.byteLength, true)
    central.view.setUint16(30, 0, true)
    central.view.setUint16(32, 0, true)
    central.view.setUint16(34, 0, true)
    central.view.setUint16(36, 0, true)
    central.view.setUint32(38, 0, true)
    central.view.setUint32(42, offset, true)
    centralDirectory.push(central.bytes, pathBytes)

    offset += local.bytes.byteLength + pathBytes.byteLength + data.byteLength
  }

  const centralDirectoryOffset = offset
  const centralDirectorySize = centralDirectory.reduce((size, chunk) => size + chunk.byteLength, 0)
  const end = createBuffer(22)
  end.view.setUint32(0, 0x06054b50, true)
  end.view.setUint16(4, 0, true)
  end.view.setUint16(6, 0, true)
  end.view.setUint16(8, files.length, true)
  end.view.setUint16(10, files.length, true)
  end.view.setUint32(12, centralDirectorySize, true)
  end.view.setUint32(16, centralDirectoryOffset, true)
  end.view.setUint16(20, 0, true)

  return new Blob([...chunks, ...centralDirectory, end.bytes].map(toBlobPart), {
    type: 'application/zip',
  })
}
