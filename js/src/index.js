/** ******************************************************************************
 *  (c) 2019 ZondaX GmbH
 *  (c) 2016-2017 Ledger
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 ******************************************************************************* */

import {serializePathv1, signSendChunkv1} from "./helperV1";
import {
  APP_KEY,
  CHUNK_SIZE,
  CLA,
  ERROR_CODE,
  errorCodeToString,
  getVersion,
  INS,
  P1_VALUES,
  PKLEN,
  processErrorResponse,
  SAPLING_ADDR_LEN,
} from "./common";

function processGetUnshieldedAddrResponse(response) {
  let partialResponse = response;

  const errorCodeData = partialResponse.slice(-2);
  const returnCode = errorCodeData[0] * 256 + errorCodeData[1];

  const addressRaw = Buffer.from(partialResponse.slice(0, PKLEN));
  partialResponse = partialResponse.slice(PKLEN);

  const address = Buffer.from(partialResponse.slice(0, -2)).toString();

  return {
    address,
    address_raw: addressRaw,
    return_code: returnCode,
    error_message: errorCodeToString(returnCode),
  };
}

function processGetShieldedAddrResponse(response) {
  let partialResponse = response;

  const errorCodeData = partialResponse.slice(-2);
  const returnCode = errorCodeData[0] * 256 + errorCodeData[1];

  const addressRaw = Buffer.from(partialResponse.slice(0, SAPLING_ADDR_LEN));
  partialResponse = partialResponse.slice(SAPLING_ADDR_LEN);

  const address = Buffer.from(partialResponse.slice(0, -2)).toString();

  return {
    address,
    address_raw: addressRaw,
    return_code: returnCode,
    error_message: errorCodeToString(returnCode),
  };
}

export default class ZCashApp {
  constructor(transport, scrambleKey = APP_KEY) {
    if (!transport) {
      throw new Error("Transport has not been defined");
    }

    this.transport = transport;
    transport.decorateAppAPIMethods(
      this,
      ["getVersion", "appInfo", "deviceInfo", "getAddressAndPubKey", "sign"],
      scrambleKey,
    );
  }

  static prepareChunks(serializedPathBuffer, message) {
    const chunks = [];

    // First chunk (only path)
    chunks.push(serializedPathBuffer);

    const messageBuffer = Buffer.from(message);

    const buffer = Buffer.concat([messageBuffer]);
    for (let i = 0; i < buffer.length; i += CHUNK_SIZE) {
      let end = i + CHUNK_SIZE;
      if (i > buffer.length) {
        end = buffer.length;
      }
      chunks.push(buffer.slice(i, end));
    }

    return chunks;
  }

  async signGetChunks(path, message) {
    return ZCashApp.prepareChunks(serializePathv1(path), message);
  }

  async getVersion() {
    return getVersion(this.transport)
      .then((response) => {
        this.versionResponse = response;
        return response;
      })
      .catch((err) => processErrorResponse(err));
  }

  async appInfo() {
    return this.transport.send(0xb0, 0x01, 0, 0).then((response) => {
      const errorCodeData = response.slice(-2);
      const returnCode = errorCodeData[0] * 256 + errorCodeData[1];

      const result = {};

      let appName = "err";
      let appVersion = "err";
      let flagLen = 0;
      let flagsValue = 0;

      if (response[0] !== 1) {
        // Ledger responds with format ID 1. There is no spec for any format != 1
        result.error_message = "response format ID not recognized";
        result.return_code = 0x9001;
      } else {
        const appNameLen = response[1];
        appName = response.slice(2, 2 + appNameLen).toString("ascii");
        let idx = 2 + appNameLen;
        const appVersionLen = response[idx];
        idx += 1;
        appVersion = response.slice(idx, idx + appVersionLen).toString("ascii");
        idx += appVersionLen;
        const appFlagsLen = response[idx];
        idx += 1;
        flagLen = appFlagsLen;
        flagsValue = response[idx];
      }

      return {
        return_code: returnCode,
        error_message: errorCodeToString(returnCode),
        // //
        appName,
        appVersion,
        flagLen,
        flagsValue,
        // eslint-disable-next-line no-bitwise
        flag_recovery: (flagsValue & 1) !== 0,
        // eslint-disable-next-line no-bitwise
        flag_signed_mcu_code: (flagsValue & 2) !== 0,
        // eslint-disable-next-line no-bitwise
        flag_onboarded: (flagsValue & 4) !== 0,
        // eslint-disable-next-line no-bitwise
        flag_pin_validated: (flagsValue & 128) !== 0,
      };
    }, processErrorResponse);
  }

  async deviceInfo() {
    return this.transport
      .send(0xe0, 0x01, 0, 0, Buffer.from([]), [ERROR_CODE.NoError, 0x6e00])
      .then((response) => {
        const errorCodeData = response.slice(-2);
        const returnCode = errorCodeData[0] * 256 + errorCodeData[1];

        if (returnCode === 0x6e00) {
          return {
            return_code: returnCode,
            error_message: "This command is only available in the Dashboard",
          };
        }

        const targetId = response.slice(0, 4).toString("hex");

        let pos = 4;
        const secureElementVersionLen = response[pos];
        pos += 1;
        const seVersion = response.slice(pos, pos + secureElementVersionLen).toString();
        pos += secureElementVersionLen;

        const flagsLen = response[pos];
        pos += 1;
        const flag = response.slice(pos, pos + flagsLen).toString("hex");
        pos += flagsLen;

        const mcuVersionLen = response[pos];
        pos += 1;
        // Patch issue in mcu version
        let tmp = response.slice(pos, pos + mcuVersionLen);
        if (tmp[mcuVersionLen - 1] === 0) {
          tmp = response.slice(pos, pos + mcuVersionLen - 1);
        }
        const mcuVersion = tmp.toString();

        return {
          return_code: returnCode,
          error_message: errorCodeToString(returnCode),
          // //
          targetId,
          seVersion,
          flag,
          mcuVersion,
        };
      }, processErrorResponse);
  }

  async getAddressAndPubKey(path, unshielded = false) {
    const serializedPath = serializePathv1(path);
    console.log(serializedPath);

    if (!unshielded) {
      return this.transport
        .send(CLA, INS.GET_ADDR_SAPLING, P1_VALUES.ONLY_RETRIEVE, 0, serializedPath, [0x9000])
        .then(processGetShieldedAddrResponse, processErrorResponse);
    }

    return this.transport
      .send(CLA, INS.GET_ADDR_SECP256K1, P1_VALUES.ONLY_RETRIEVE, 0, serializedPath, [0x9000])
      .then(processGetUnshieldedAddrResponse, processErrorResponse);
  }

  async showAddressAndPubKey(path, unshielded = false) {
    const serializedPath = serializePathv1(path);
    console.log(serializedPath);

    console.log(unshielded)
    if (!unshielded) {
      return this.transport
        .send(CLA, INS.GET_ADDR_SAPLING, P1_VALUES.SHOW_ADDRESS_IN_DEVICE, 0, serializedPath, [0x9000])
        .then(processGetShieldedAddrResponse, processErrorResponse);
    }

    return this.transport
      .send(CLA, INS.GET_ADDR_SECP256K1, P1_VALUES.SHOW_ADDRESS_IN_DEVICE, 0, serializedPath, [0x9000])
      .then(processGetUnshieldedAddrResponse, processErrorResponse);
  }

  async signSendChunk(chunkIdx, chunkNum, chunk) {
    return signSendChunkv1(this, chunkIdx, chunkNum, chunk);
  }

  async sign(path, message, unshielded = false) {
    return this.signGetChunks(path, message).then((chunks) => {
      return this.signSendChunk(1, chunks.length, chunks[0], [ERROR_CODE.NoError]).then(async (response) => {
        let result = {
          return_code: response.return_code,
          error_message: response.error_message,
          signature_compact: null,
          signature_der: null,
        };

        for (let i = 1; i < chunks.length; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          result = await this.signSendChunk(1 + i, chunks.length, chunks[i]);
          if (result.return_code !== ERROR_CODE.NoError) {
            break;
          }
        }

        return {
          return_code: result.return_code,
          error_message: result.error_message,
          // ///
          signature_compact: result.signature_compact,
          signature_der: result.signature_der,
        };
      }, processErrorResponse);
    }, processErrorResponse);
  }
}
