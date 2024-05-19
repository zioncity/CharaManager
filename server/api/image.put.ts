import { createDatabase } from 'db0';
import sqlite from 'db0/connectors/better-sqlite3';
import { drizzle } from 'db0/integrations/drizzle/index';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import ApiResponse from '~/models/ApiResponse';
import PutDefinitionRequest from '~/models/PutDefinitionRequest';
import type PutImageRequest from '~/models/PutImageRequest';
import StatusCode from '~/models/enums/StatusCode';
import convertBase64PNGToString from '~/server/utils/convertBase64PNGToString';
import { character_images } from '~/utils/drizzle/schema';

// noinspection JSUnusedGlobalSymbols
export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event);

    const apiKey = event.headers.get('x-api-key');
    if (!apiKey || apiKey !== config.public.apiKey) {
        return new ApiResponse(StatusCode.FORBIDDEN, 'Missing or invalid API key given.');
    }

    const body = await readBody<PutImageRequest>(event);
    if (!body) {
        return new ApiResponse(StatusCode.BAD_REQUEST, 'The request body is malformed or corrupted.');
    }

    const db = createDatabase(sqlite({ name: 'CharaManager' }));
    const drizzleDb = drizzle(db);

    try {
        const hash = createHash('sha256').update(body.Base64Image).digest('hex');
        await drizzleDb
            .insert(character_images)
            .values({ id: body.Id, content: body.Base64Image, hash: hash })
            .onConflictDoUpdate({ target: character_images.id, set: { content: body.Base64Image } });
    } catch (err) {
        return new ApiResponse(StatusCode.INTERNAL_SERVER_ERROR, 'Failed to upsert character image.', err);
    }

    try {
        if (!fs.existsSync('public/cards/')) {
            fs.mkdirSync('public/cards/');
        }

        fs.writeFile(`public/cards/${body.Id}.png`, body.Base64Image.split('base64,')[1], { encoding: 'base64' }, function (err) {
            if (err) {
                throw err;
            }
        });
    } catch (err) {
        return new ApiResponse(StatusCode.INTERNAL_SERVER_ERROR, 'Image saved to table, but failed to write image to disk.', err);
    }

    const json = convertBase64PNGToString(body.Base64Image);
    const response = await $fetch<ApiResponse>('/api/definition', {
        method: 'PUT',
        headers: { 'x-api-key': config.public.apiKey },
        body: JSON.stringify(new PutDefinitionRequest(body.Id, json, true)),
    });

    if (response.Status !== StatusCode.OK) {
        return new ApiResponse(StatusCode.INTERNAL_SERVER_ERROR, 'Image saved to table and disk, but failed update definition.', response.Content);
    }

    return new ApiResponse(StatusCode.OK, 'Image successfully saved to table and disk, updated definition.');
});
