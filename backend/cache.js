import { createClient } from 'redis';

const client = createClient({
    username: 'default',
    password: 'nptH0GBbnpCieeG5gRTfMFpE8wP7MQFK',
    socket: {
        host: 'redis-16193.crce194.ap-seast-1-1.ec2.cloud.redislabs.com',
        port: 16193
    }
});

client.on('error', (err) => console.log('Redis Client Error', err));

let isConnected = false;

export const cache = {
    connect: async () => {
        if (!isConnected) {
            await client.connect();
            isConnected = true;
            console.log('Redis connected');
        }
    },
    get: async (key) => {
        if (!isConnected) await cache.connect();
        const value = await client.get(key);
        return value ? JSON.parse(value) : null;
    },
    set: async (key, value, ttlSeconds = null) => {
        if (!isConnected) await cache.connect();
        if (ttlSeconds) {
            await client.setEx(key, ttlSeconds, JSON.stringify(value));
        } else {
            await client.set(key, JSON.stringify(value));
        }
    },
    // Delete every key that matches a glob pattern (e.g. `api_req:*velolo*`).
    // Walks the keyspace via SCAN so big stores don't get blocked, then issues
    // a single DEL per batch. Returns the total number of deleted keys.
    delByPattern: async (pattern) => {
        if (!isConnected) await cache.connect();
        let deleted = 0;
        let cursor = '0';
        do {
            const reply = await client.scan(cursor, { MATCH: pattern, COUNT: 200 });
            // node-redis v4 returns { cursor, keys }
            cursor = String(reply.cursor ?? reply[0] ?? '0');
            const keys = reply.keys ?? reply[1] ?? [];
            if (keys.length) {
                await client.del(keys);
                deleted += keys.length;
            }
        } while (cursor !== '0');
        return deleted;
    },
    client
};

