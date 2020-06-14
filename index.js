require('dotenv').config();
const { v4: uuid } = require('uuid');


/** Setup Redis */
const redis = new (require("ioredis"))();


/** Setup Bolt */
const { App } = require('@slack/bolt');

const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
});


/** Setup Airtable Client */
const Airtable = require('airtable');

Airtable.configure({
    endpointUrl: 'https://api.airtable.com',
    apiKey: process.env.AIRTABLE_API_KEY
});

const airtableClient = Airtable.base(process.env.AIRTABLE_BASE);



/** Handles the main cadre-cares slash command */
app.command('/cadre-cares', async ({command, ack, respond}) => {
    console.log(`SLACK SLASH COMMAND: /cadre-cares\n${JSON.stringify(command, null, 2)}`);
    ack();

    const message = {
        blocks: [{
            type: 'actions',
            elements: [{
                type: "button",
                text: {type: "plain_text", text: "Find a Volunteer Opportunity"},
                value: "find_opportunity",
                action_id: "find_opportunity",
            }, {
                type: "button",
                text: {type: "plain_text", text: "Create a Volunteer Opportunity"},
                value: "create_opportunity",
                action_id: "create_opportunity",
            }]
        }]
    };

    respond(message);
});

/** Handles create volunteer opportunity button click */
app.action('create_opportunity', async ({body, ack, respond}) => {
    console.log(`SLACK ACTION: create_opportunity\n${JSON.stringify(body, null, 2)}`);
    ack();

    const message = {
        blocks: [{
            type: "section",
            text: {
                type: "mrkdwn",
                text: "Click [here](https://airtable.com/shrJnANZdsM7WBF49) to create a volunteer opportunity."
            },
        }]
    };

    respond(message);
});

/** Handles find volunteer opportunity button click */
app.action('find_opportunity', async ({body, ack, respond}) => {
    console.log(`SLACK ACTION: find_opportunity\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Clear out any previous volunteer query for the user & set result offset to 0
    const userId = body.user.id;
    await redis.hdel(`user:${userId}:volunteer_query`);
    await redis.hset(`user:${userId}:volunteer_query`, 'result_offset', 0);

    // Query airtable for possible time commitment values
    const timeCommitments = await queryAirtableColumnOptions('Volunteer Opportunities', 'Time Commitment');
    const locations = await queryAirtableColumnOptions('Volunteer Opportunities', 'Location');
    const areasOfFocus = await queryAirtableColumnOptions('Volunteer Opportunities', 'Area of Focus');

    // Ask the user when they want commit time to volunteer
    const message = {
        blocks: [{
            type: 'actions',
            elements: [{
                type: "multi_static_select",
                action_id: 'find_opportunity_time_commitment_select',
                placeholder: { type: "plain_text", text: "Select time commitments." },
                options: timeCommitments.map(timeCommitment => ({
                    text: { type: "plain_text", text: timeCommitment },
                    value: timeCommitment
                }))
            }, {
                type: "multi_static_select",
                action_id: 'find_opportunity_location_select',
                placeholder: { type: "plain_text", text: "Select locations." },
                options: locations.map(location => ({
                    text: { type: "plain_text", text: location },
                    value: location
                }))
            }, {
                type: "multi_static_select",
                action_id: 'find_opportunity_areas_of_focus_select',
                placeholder: { type: "plain_text", text: "Select areas of focus." },
                options: areasOfFocus.map(areaOfFocus => ({
                    text: { type: "plain_text", text: areaOfFocus },
                    value: areaOfFocus
                }))
            }, {
                type: "button",
                text: { type: "plain_text", text: "Search" },
                value: "search",
                action_id: "find_opportunity_results",
                style: "primary",
            }]
        }]
    };

    respond(message);
});


/** Handles time commitment selection while finding volunteer opportunities */
app.action('find_opportunity_time_commitment_select', async ({body, ack}) => {
    console.log(`SLACK ACTION: find_opportunity_time_commitment_select\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Update the query to include selected time commitments from step 0
    const userId = body.user.id; 
    const selectedTimeCommitments = body.actions[0].selected_options.map(option => option.value);
    await redis.hset(`user:${userId}:volunteer_query`, 'time_commitments', selectedTimeCommitments);
});

/** Handles time commitment selection while finding volunteer opportunities */
app.action('find_opportunity_location_select', async ({body, ack}) => {
    console.log(`SLACK ACTION: find_opportunity_location_select\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Update the query to include selected time commitments from step 0
    const userId = body.user.id; 
    const selectedLocations = body.actions[0].selected_options.map(option => option.value);
    await redis.hset(`user:${userId}:volunteer_query`, 'locations', selectedLocations);
});

/** Handles time commitment selection while finding volunteer opportunities */
app.action('find_opportunity_areas_of_focus_select', async ({body, ack}) => {
    console.log(`SLACK ACTION: find_opportunity_areas_of_focus_select\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Update the query to include selected time commitments from step 0
    const userId = body.user.id; 
    const selectedAreasOfFocus = body.actions[0].selected_options.map(option => option.value);
    await redis.hset(`user:${userId}:volunteer_query`, 'areas_of_focus', selectedAreasOfFocus);
});


/** Handles time commitment selection while finding volunteer opportunities */
app.action('find_opportunity_results', async ({body, ack, context}) => {
    console.log(`SLACK ACTION: find_opportunity_results\n${JSON.stringify(body, null, 2)}`);
    ack();

    const userId = body.user.id;
    const channelId = body.channel.id;
    const recordsPerPage = 3;

    // Get query params from redis
    const query = await redis.hgetall(`user:${userId}:volunteer_query`);

    // Construct airtable filter formula
    const filterClauses = [];

    if (query.time_commitments) {
        filterClauses.append(`OR(${query.time_commitments
            .map(timeCommitment => `{Time Commitment} = '${timeCommitment}'`)
            .join(', ')
        })`)
    }

    if (query.locations) {
        filterClauses.append(`OR(${query.locations
            .map(location => `{Location} = '${location}'`)
            .join(', ')
        })`)
    }

    if (query.areas_of_focus) {
        filterClauses.append(`OR(${query.areas_of_focus
            .map(areaOfFocus => `{Area of Focus} = '${areaOfFocus}'`)
            .join(', ')
        })`)
    }

    const airtableQueryParams = filterClauses ? {filterByFormula: `AND(${filterClauses.join(', ')})`} : {};

    // Query airtable
    const records = await queryAirtable('Volunteer Opportunities', queryParams=airtableQueryParams);
    const pageRecords = records.slice(query.result_offset, query.result_offset + recordsPerPage);
    const hasMoreRecords = query.result_offset + recordsPerPage < records.length;

    // Update result offset for next time we call this
    await redis.hincrby(`user:${userId}:volunteer_query`, 'result_offset', recordsPerPage);

    // Display results
    const message = {
        blocks: [
            ...(pageRecords ? 
                pageRecords.map(record => ({
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `Project Name: ${record.get('Project Name')}\nOrganization: ${record.get('Organization')}`
                    },
                })) : [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "Didn't find any matching results :persevere:"
                    },
                }]
            ),
            ...(hasMoreRecords ? [{
                type: 'actions',
                elements: [{
                    type: "button",
                    text: { type: "plain_text", text: "Next" },
                    value: "next",
                    action_id: "find_opportunity_results",
                }]
            }] : [])
        ]
    };

    await postChatPrivate(channelId, userId, context, message);
});


/** Util to post a chat message that is only visible to the given user */
async function postChatPrivate(channelId, userId, context, message) {
    try {
        await app.client.chat.postEphemeral({
            token: context.botToken,
            channel: channelId,
            user: userId,
            ...message
        });        
    } catch (err) {
        console.log(`private chat message error:\n${JSON.stringify(message, null, 2)}`);
        console.error(err);
    }
}

/** Util to post a chat message that is visible to the entire channel */
async function postChat(channelId, userId, context, message) {
    try {
        await app.client.chat.postMessage({
            token: context.botToken,
            channel: channelId,
            user: userId,
            ...message
        });
    } catch (err) {
        console.log(`chat message error:\n${JSON.stringify(message, null, 2)}`);
        console.error(err);
    }
}

/** 
 * Util to query an airtable table for a given set of records
 * See the link below for a list of valid queryParam values
 * https://airtable.com/appIfeZ52jolhZ08w/api/docs#javascript/table:volunteer%20opportunities:list
*/
function queryAirtable(tableName, queryParams = {}) {
    let records = [];

    return new Promise((resolve, reject) => {
        airtableClient(tableName).select({
            view: 'Grid view',
            ...queryParams
        }).eachPage((pageRecords, fetchNextPage) => {
            records = records.concat(pageRecords);
            fetchNextPage();
        }, function done(err) {
            if (err) reject(err);
            else resolve(records);
        })
    });
}

/** Util to query options for a specific column */
function queryAirtableColumnOptions(tableName, columnName) {
    // Airtable doesn't provide any metadata endpoints :(
    // https://community.airtable.com/t/metadata-api-for-schema-and-mutating-tables/1856

    // So apparently there's no way to find what options are available for a multiselect column
    // the hacky way I'm getting around this is just query the entire table and see what values are
    // returned ¯\_(ツ)_/¯

    const records = await queryAirtable(tableName, {fields: [columnName]});
    const columnOptions = records.map(record => record.get(columnName));

    return [...new Set(columnOptions)];
}