/*******************************************************************************
*   (c) 2019 Zondax GmbH
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
********************************************************************************/
#pragma once

#include <stdint.h>
#include "crypto.h"
#include "tx.h"
#include "apdu_codes.h"
#include <os_io_seproxyhal.h>
#include "coin.h"

typedef struct {
    address_kind_e kind;
    uint8_t len;
} address_state_t;

extern address_state_t address_state;

__Z_INLINE void app_sign() {
    // Take "ownership" of the memory used by the transaction parser
    tx_reset_state();

    const uint8_t *message = tx_get_buffer() + CRYPTO_BLOB_SKIP_BYTES;
    const uint16_t messageLength = tx_get_buffer_length() - CRYPTO_BLOB_SKIP_BYTES;
    const uint8_t replyLen = crypto_sign(G_io_apdu_buffer, IO_APDU_BUFFER_SIZE - 3, message, messageLength);

    if (replyLen > 0) {
        set_code(G_io_apdu_buffer, replyLen, APDU_CODE_OK);
        io_exchange(CHANNEL_APDU | IO_RETURN_AFTER_TX, replyLen + 2);
    } else {
        set_code(G_io_apdu_buffer, 0, APDU_CODE_SIGN_VERIFY_ERROR);
        io_exchange(CHANNEL_APDU | IO_RETURN_AFTER_TX, 2);
    }
}

__Z_INLINE void app_reject() {
    tx_reset_state();

    set_code(G_io_apdu_buffer, 0, APDU_CODE_COMMAND_NOT_ALLOWED);
    io_exchange(CHANNEL_APDU | IO_RETURN_AFTER_TX, 2);
}

__Z_INLINE uint8_t app_fill_address(address_kind_e kind) {
    // Put data directly in the apdu buffer
    MEMZERO(G_io_apdu_buffer, IO_APDU_BUFFER_SIZE);
    zemu_log_stack("app_fill_address");

    address_state.kind = kind;

    switch (kind) {
        case addr_secp256k1:
            address_state.len = crypto_fillAddress_secp256k1(G_io_apdu_buffer, IO_APDU_BUFFER_SIZE - 2);
            break;
        case addr_sapling:
            address_state.len = crypto_fillAddress_sapling(G_io_apdu_buffer, IO_APDU_BUFFER_SIZE - 2);
            break;
        default:
            address_state.len = 0;
            break;
    }

    return address_state.len;
}

__Z_INLINE void app_reply_address() {
    set_code(G_io_apdu_buffer, address_state.len, APDU_CODE_OK);
    io_exchange(CHANNEL_APDU | IO_RETURN_AFTER_TX, address_state.len + 2);
}

__Z_INLINE void app_reply_error() {
    set_code(G_io_apdu_buffer, 0, APDU_CODE_DATA_INVALID);
    io_exchange(CHANNEL_APDU | IO_RETURN_AFTER_TX, 2);
}
