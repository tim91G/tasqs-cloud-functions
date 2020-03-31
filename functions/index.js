let functions = require('firebase-functions');
let admin = require('firebase-admin');
admin.initializeApp();

exports.notifyNewTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onCreate((snap, context) => {
        const task = snap.data();
        const user = task.user;
        return setNotification(task, user, context);
    });

exports.notifyUpdateTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onUpdate((snap, context) => {
        const task = snap.after.data();
        const previousTask = snap.before.data();
        const user = task.user;

       // prevent infinite loop and unnessesery fcm callbacks
      if (task.meta_data.start_datetime === previousTask.meta_data.start_datetime && 
          task.user.id === previousTask.user.id && 
          task.description === previousTask.description) return null;

        return setNotification(task, user, context);
    });

exports.notifyDeleteTask = functions.firestore
    .document('households/{household}/tasks/{task}')
    .onDelete((snap, context) => {
        const task = snap.data();
        const user = task.user;
        return deleteNotification(task, user);
    });

function setNotification(task, user, context) {
    return admin.firestore().doc(`households/${context.params.household}/tasks/${context.params.task}`).update({"is_done_enabled": true}).then(doc => {

            
    return admin.firestore().collection('users').doc(user.id).get().then(userDoc => {
        const userData = userDoc.data();
        const userId = userData.id;
        const registrationTokens = userData.registrationTokens;

        const payload = {
            data: {
                TASK_DESCRIPTION: task.description,
                TASK_TIMEZONE: task.meta_data.time_zone,
                TASK_ID: task.id,
                USER_NAME: userData.name,
                TASK_START_DATE: String(task.meta_data.start_datetime),
                IS_DELETED: 'false',
                click_action : "MainActivity"
            }
        }

        return sendToDevice(registrationTokens, payload, userId)
    })
});

}

function deleteNotification(task, user) {
    return admin.firestore().collection('users').doc(user.id).get().then(userDoc => {
        const userId = userDoc.data().id;
        const registrationTokens = userDoc.data().registrationTokens;

        const payload = {
            data: {
                TASK_ID: task.id,
                IS_DELETED: 'true'
            }
        }

        return sendToDevice(registrationTokens, payload, userId)
    })
}

function sendToDevice(registrationTokens, payload, userId) {
    return admin.messaging().sendToDevice(registrationTokens, payload).then(response => {
        const stillRegisteredTokens = registrationTokens

        response.results.forEach((result, index) => {
            const error = result.error
            if (error) {
                const failedRegistrationToken = registrationTokens[index]
                console.error('Error', failedRegistrationToken, error)
                if (error.code === 'messaging/invalid-registration-token'
                    || error.code === 'messaging/registration-token-not-registered') {
                    const failedIndex = stillRegisteredTokens.indexOf(failedRegistrationToken)
                    if (failedIndex > -1) {
                        stillRegisteredTokens.splice(failedIndex, 1)
                    }
                }
            }
        })

        return admin.firestore().doc("users/" + userId).update({
            registrationTokens: stillRegisteredTokens
        })
    })
}