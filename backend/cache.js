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
    client
};
