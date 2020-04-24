'use strict';

let functions = require('firebase-functions');
let admin = require('firebase-admin');
admin.initializeApp();

exports.notifyNewTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onCreate(async (snap, context) => {
        const task = snap.data();
       
        return setNotification(task)
    });

exports.notifyUpdateTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onUpdate(async (snap, context) => {
        const newTask = snap.after.data();
        const previousTask = snap.before.data();

        // prevent infinite loop and unnessesery fcm callbacks
        if (newTask.meta_data.start_datetime === previousTask.meta_data.start_datetime &&
            newTask.user.id === previousTask.user.id &&
            newTask.description === previousTask.description) return null;

        if (newTask.user.id !== previousTask.user.id) {   
           deleteNotification(previousTask)
           return setNotification(newTask)
        } 
    
        return setNotification(newTask)
    });

exports.notifyDeleteTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onDelete(async (snap, context) => {
        const task = snap.data();
        return deleteNotification(task);
    });

async function setNotification(task) {
    const user = await admin.firestore().doc(`users/${task.user.id}`).get()
    const userData = user.data();
    const payload = {
        data: {
            TASK_DESCRIPTION: task.description,
            TASK_TIMEZONE: task.meta_data.time_zone,
            TASK_ID: task.id,
            USER_NAME: task.user.name,
            TASK_START_DATE: String(task.meta_data.start_datetime),
            IS_DELETED: 'false',
            click_action: "MainActivity"
        }
    };
    console.log('Notification set:', task.description, 'for user:', task.user.name);

    // // re-enable the 'done' button for the task 
    // // This will trigger onUpdate (again) so a guard is in place to prevent an infinite loop
    // admin.firestore().doc(`households/${householdId}/tasks/${task.id}`).update({ is_done_enabled: true });

    // send data notification to subscribed tokens
    return sendToDevice(userData.registrationTokens, payload, task.user.id);
}

async function deleteNotification(task) {
    const user = await admin.firestore().doc(`users/${task.user.id}`).get()
    const userData = user.data();
    const payload = {
        data: {
            TASK_ID: task.id,
            IS_DELETED: 'true'
        }
    };

    console.log('Notification deleted:', task.id, 'for user:', task.user.name);

    // send data notification to subscribed tokens
    return sendToDevice(userData.registrationTokens, payload, task.user.id);
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

    // update user tokens
    return admin.firestore().doc("users/" + userId).update({ registrationTokens: stillTokens });
}
