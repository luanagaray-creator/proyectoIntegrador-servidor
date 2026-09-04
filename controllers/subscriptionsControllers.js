const data = require('../data/subscriptionsData.js');

function getSubscriptions(req, res) {
    res.json(data.subscriptions)
}

function getSubscriptionById(req, res) {
    const subscription = data.subscriptions.find(s => s.id === parseInt(req.params.id));
    if (subscription) {
        res.json(subscription);
    } else {
        res.status(404).json({ message: 'Suscripción no encontrada' });
    }
}

function createSubscription(req, res) {
    const newSubscription = {
        id: data.subscriptions.length + 1,
        usuarioId: req.body.usuarioId,
        plan: req.body.plan
    };
    data.subscriptions.push(newSubscription);
    res.status(201).json(newSubscription);
}

function updateSubscription(req, res) {
    const subscriptionIndex = data.subscriptions.findIndex(s => s.id === parseInt(req.params.id));
    if (subscriptionIndex !== -1) {
        data.subscriptions[subscriptionIndex] = { ...data.subscriptions[subscriptionIndex], ...req.body };
        res.json(data.subscriptions[subscriptionIndex]);
    } else {
        res.status(404).json({ message: 'Suscripción no encontrada' });
    }
}

function deleteSubscription(req, res) {
    const subscriptionIndex = data.subscriptions.findIndex(s => s.id === parseInt(req.params.id));
    if (subscriptionIndex !== -1) {
        data.subscriptions.splice(subscriptionIndex, 1);
        res.json({ message: 'Suscripción eliminada' });
    } else {
        res.status(404).json({ message: 'Suscripción no encontrada' });
    }
}

export { getSubscriptions, getSubscriptionById, createSubscription, updateSubscription, deleteSubscription };