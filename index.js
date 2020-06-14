require('dotenv').config();

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

    try {
        await respond(message);
    } catch (err) {
        console.error(err);
    }
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
                text: "Click the link below to create a volunteer opportunity:\nhttps://airtable.com/shrJnANZdsM7WBF49"
            },
        }]
    };

    try {
        await respond(message);
    } catch (err) {
        console.error(err);
    }
});

/** Handles find volunteer opportunity button click */
app.action('find_opportunity', async ({body, ack, respond}) => {
    console.log(`SLACK ACTION: find_opportunity\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Clear out any previous volunteer query for the user & set result offset to 0
    const userId = body.user.id;
    await redis.del(`user:${userId}:volunteer_query:time_commitments_select`);
    await redis.del(`user:${userId}:volunteer_query:locations_select`);
    await redis.del(`user:${userId}:volunteer_query:areas_of_focus_select`);
    await redis.set(`user:${userId}:volunteer_query:offset`, 0);

    // Query airtable for select dropdown options
    const timeCommitments = await queryAirtableColumnOptions('Volunteer Opportunities', 'Time Commitment');
    const locations = await queryAirtableColumnOptions('Volunteer Opportunities', 'Location');
    const areasOfFocus = await queryAirtableColumnOptions('Volunteer Opportunities', 'Area of Focus');

    // Ask the user when they want commit time to volunteer
    const message = {
        blocks: [{
            type: "section",
            text: { type: "plain_text", text: "Select time commitments." },
            accessory: {
                type: "multi_static_select",
                action_id: 'find_opportunity_time_commitments_select',
                placeholder: { type: "plain_text", text: "Select time commitments." },
                options: timeCommitments.map(timeCommitment => ({
                    text: { type: "plain_text", text: timeCommitment },
                    value: timeCommitment
                }))
            }
        }, {
            type: "section",
            text: { type: "plain_text", text: "Select locations." },
            accessory: {
                type: "multi_static_select",
                action_id: 'find_opportunity_locations_select',
                placeholder: { type: "plain_text", text: "Select locations." },
                options: locations.map(location => ({
                    text: { type: "plain_text", text: location },
                    value: location
                }))
            }
        }, {
            type: "section",
            text: { type: "plain_text", text: "Select areas of focus." },
            accessory: {
                type: "multi_static_select",
                action_id: 'find_opportunity_areas_of_focus_select',
                placeholder: { type: "plain_text", text: "Select areas of focus." },
                options: areasOfFocus.map(areaOfFocus => ({
                    text: { type: "plain_text", text: areaOfFocus },
                    value: areaOfFocus
                }))
            }
        }, {
            type: 'actions',
            elements: [{
                type: "button",
                text: { type: "plain_text", text: "Search" },
                value: "initial",
                action_id: "find_opportunity_results",
                style: "primary",
            }]
        }]
    };

    try {
        await respond(message);
    } catch (err) {
        console.error(err);
    }
});


/** Handles time commitment dropdown selection */
app.action('find_opportunity_time_commitments_select', async ({body, ack}) => {
    console.log(`SLACK ACTION: find_opportunity_time_commitments_select\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Update the query to include selected time commitments
    const userId = body.user.id; 
    const selectedTimeCommitments = body.actions[0].selected_options.map(option => option.value);

    await redis.del(`user:${userId}:volunteer_query:time_commitments_select`);
    if (selectedTimeCommitments.length)
        await redis.sadd(`user:${userId}:volunteer_query:time_commitments_select`, selectedTimeCommitments);
});

/** Handles location dropdown selection */
app.action('find_opportunity_locations_select', async ({body, ack}) => {
    console.log(`SLACK ACTION: find_opportunity_locations_select\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Update the query to include selected locations
    const userId = body.user.id; 
    const selectedLocations = body.actions[0].selected_options.map(option => option.value);

    await redis.del(`user:${userId}:volunteer_query:locations_select`);
    if (selectedLocations.length)
        await redis.sadd(`user:${userId}:volunteer_query:locations_select`, selectedLocations);
});

/** Handles area of focus dropdown selection */
app.action('find_opportunity_areas_of_focus_select', async ({body, ack}) => {
    console.log(`SLACK ACTION: find_opportunity_areas_of_focus_select\n${JSON.stringify(body, null, 2)}`);
    ack();

    // Update the query to include selected areas of focus
    const userId = body.user.id; 
    const selectedAreasOfFocus = body.actions[0].selected_options.map(option => option.value);

    await redis.del(`user:${userId}:volunteer_query:areas_of_focus_select`);
    if (selectedAreasOfFocus.length)
        await redis.sadd(`user:${userId}:volunteer_query:areas_of_focus_select`, selectedAreasOfFocus);
});


/** Handles search/next/previous button clicks */
app.action('find_opportunity_results', async ({body, ack, respond}) => {
    console.log(`SLACK ACTION: find_opportunity_results\n${JSON.stringify(body, null, 2)}`);
    ack();

    const userId = body.user.id;
    const recordsPerPage = 3;
    const buttonValue = body.actions[0].value;

    // Update result offset based on the button value
    if (buttonValue === 'next')
        await redis.incrby(`user:${userId}:volunteer_query:offset`, recordsPerPage);
    else if (buttonValue === 'prev')
        await redis.incrby(`user:${userId}:volunteer_query:offset`, -1 * recordsPerPage);

    // Get query params from redis
    const timeCommitments = await redis.smembers(`user:${userId}:volunteer_query:time_commitments_select`) || [];
    const locations = await redis.smembers(`user:${userId}:volunteer_query:locations_select`) || [];
    const areasOfFocus = await redis.smembers(`user:${userId}:volunteer_query:areas_of_focus_select`) || [];
    const offset = await redis.get(`user:${userId}:volunteer_query:offset`) || 0;

    console.log(`timeCommitments: ${JSON.stringify(timeCommitments)}`);
    console.log(`locations: ${JSON.stringify(locations)}`);
    console.log(`areasOfFocus: ${JSON.stringify(areasOfFocus)}`);
    console.log(`offset: ${offset}`);

    // Construct airtable filter formula
    const filterClauses = [];

    if (timeCommitments.length) {
        filterClauses.push(`OR(${timeCommitments
            .map(timeCommitment => `{Time Commitment} = '${timeCommitment}'`)
            .join(', ')
        })`)
    }

    if (locations.length) {
        filterClauses.push(`OR(${locations
            .map(location => `{Location} = '${location}'`)
            .join(', ')
        })`)
    }

    if (areasOfFocus.length) {
        filterClauses.push(`OR(${areasOfFocus
            .map(areaOfFocus => `{Area of Focus} = '${areaOfFocus}'`)
            .join(', ')
        })`)
    }

    let airtableQueryParams = {};
    if (filterClauses.length)
        airtableQueryParams = {filterByFormula: `AND(${filterClauses.join(', ')})`};

    // Query airtable
    const records = await queryAirtable('Volunteer Opportunities', queryParams=airtableQueryParams);
    const pageRecords = records.slice(offset, offset + recordsPerPage);
    const hasResults = pageRecords && pageRecords.length;
    const hasNextRecords = offset + recordsPerPage < records.length;
    const hasPrevRecords = offset > 0;

    console.log(`pageRecords.length: ${pageRecords.length}`);
    console.log(`hasResults: ${hasResults}`);
    console.log(`hasNextRecords: ${hasNextRecords}`);
    console.log(`hasPrevRecords: ${hasPrevRecords}`);

    // Display results
    const message = {
        blocks: [
            ...(hasResults ? pageRecords.map(record => ({
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
            }]),
            ...(hasNextRecords || hasPrevRecords ? [{
                type: 'actions',
                elements: [
                    ...(hasPrevRecords ? [{
                        type: "button",
                        text: { type: "plain_text", text: "Previous" },
                        value: "prev",
                        action_id: "find_opportunity_results",
                    }] : []),
                    ...(hasNextRecords ? [{
                        type: "button",
                        text: { type: "plain_text", text: "Next" },
                        value: "next",
                        action_id: "find_opportunity_results",
                    }] : [])
                ]
            }] : [])
        ]
    };

    try {
        await respond(message);
    } catch (err) {
        console.error(err);
    }
});

/** 
 * Util to query an airtable table for a given set of records
 * See the link below for a list of valid queryParam values
 * https://airtable.com/appIfeZ52jolhZ08w/api/docs#javascript/table:volunteer%20opportunities:list
*/
function queryAirtable(tableName, queryParams = {}) {
    console.log(`Querying Airtable Table "${tableName}": ${JSON.stringify(queryParams)}`);
    let records = [];

    return new Promise((resolve, reject) => {
        airtableClient(tableName).select({
            view: 'Grid view',
            ...queryParams
        }).eachPage((pageRecords, fetchNextPage) => {
            records = records.concat(pageRecords);
            fetchNextPage();
        }, function done(err) {
            if (err) {
                console.error(`Failed to fetch from airtable: ${err}`);
                reject(err);
            } else {
                console.log(`Finished fetching records from airtable. Fetch ${records.length} records total.`);
                resolve(records)
            }
        })
    });
}

/** Util to query options for a specific column */
async function queryAirtableColumnOptions(tableName, columnName) {
    // Airtable doesn't provide any metadata endpoints :(
    // https://community.airtable.com/t/metadata-api-for-schema-and-mutating-tables/1856

    // So apparently there's no way to find what options are available for a multiselect column
    // the hacky way I'm getting around this is just query the entire table and see what values are
    // returned ¯\_(ツ)_/¯

    console.log(`Querying Airtable Column Options (tableName: ${tableName} columnName: ${columnName})`);
    const records = await queryAirtable(tableName, {fields: [columnName]});
    const columnOptions = records.map(record => record.get(columnName));
    console.log(`Finished fetching column options: ${JSON.stringify(columnOptions)}`);

    return [...new Set(columnOptions.flat())];
}

(async () => {
    // Start the App
    await app.start(process.env.PORT);
  
    console.log('⚡️ Bolt app is running!');
})();