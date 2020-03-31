'use strict';

let functions = require('firebase-functions');
let admin = require('firebase-admin');
admin.initializeApp();

exports.notifyNewTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onCreate(async (snap, context) => {
        const task = snap.data();

        console.log('new task created:', task.id, 'for date:', task.meta_data.start_datetime);

        // build notification data and send to subscribed tokens
        return sendNotification(task, context)
    });

exports.notifyUpdateTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onUpdate(async (snap, context) => {
        const task = snap.after.data();
        const previousTask = snap.before.data();

        // prevent infinite loop and unnessesery fcm callbacks
        if (task.meta_data.start_datetime === previousTask.meta_data.start_datetime &&
            task.user.id === previousTask.user.id &&
            task.description === previousTask.description) return null;

        console.log('task updated:', task.id, 'for date:', task.meta_data.start_datetime);

        // send data notification to subscribed tokens
        return sendNotification(task, context)
    });

exports.notifyDeleteTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onDelete(async (snap, context) => {
        const task = snap.data();
        const user = await admin.firestore().doc(`users/${task.user.id}`).get()
        const userData = user.data();
        const payload = {
            data: {
                TASK_ID: task.id,
                IS_DELETED: 'true'
            }
        };

        console.log('task deleted:', task.id, 'for user:', userData.name);

        // send data notification to subscribed tokens
        return sendToDevice(userData.registrationTokens, payload, userData.id);
    });

async function sendNotification(task, context) {
    const user = await admin.firestore().doc(`users/${task.user.id}`).get()
    const userData = user.data();
    const payload = {
        data: {
            TASK_DESCRIPTION: task.description,
            TASK_TIMEZONE: task.meta_data.time_zone,
            TASK_ID: task.id,
            USER_NAME: userData.name,
            TASK_START_DATE: String(task.meta_data.start_datetime),
            IS_DELETED: 'false',
            click_action: "MainActivity"
        }
    };
    console.log('payload: ', payload);

    // re-enable the 'done' button for the task 
    // This will trigger onUpdate (again) so a guard is in place to prevent an infinite loop
    await admin.firestore().doc(`households/${context.params.household}/tasks/${context.params.task}`).update({ "is_done_enabled": true });

    // send data notification to subscribed tokens
    return sendToDevice(userData.registrationTokens, payload, userData.id);
}

async function sendToDevice(tokens, payload, userId) {
    const response = await admin.messaging().sendToDevice(tokens, payload);
    const stillTokens = tokens;

    // remove unused tokens
    response.results.forEach((result, index) => {
        const error = result.error
        if (error) {
            const failedRegistrationToken = tokens[index]
            console.error('Error', failedRegistrationToken, error)
            if (error.code === 'messaging/invalid-registration-token'
                || error.code === 'messaging/registration-token-not-registered') {
                const failedIndex = stillTokens.indexOf(failedRegistrationToken)
                if (failedIndex > -1) {
                    stillTokens.splice(failedIndex, 1)
                }
            }
        }
    })
    console.log('stillTokens:', stillTokens);

    // update user tokens
    return admin.firestore().doc("users/" + userId).update({
        registrationTokens: stillTokens
    });
}
