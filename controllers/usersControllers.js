const data = require('../data/usersData.js');

function getUsers(req, res) {
    res.json(data.users)
};

function getUserById(req, res) {
    const userId = parseInt(req.params.id);
    const user = data.users.find(u => u.id === userId);
    if (user) {
        res.json(user);
    } else {
        res.status(404).json({ error: 'Usuario no encontrado' });
    }
}

function createUser(req, res) {
    const { id, nombre, apellido } = req.body;
    const newUser = { id, nombre, apellido };
    data.users.push(newUser);
    res.status(201).json(newUser);
}

function updateUser(req, res) {
    const userId = parseInt(req.params.id);
    const user = data.users.find(u => u.id === userId);
    if (user) {
        const { nombre, apellido } = req.body;
        user.nombre = nombre || user.nombre;
        user.apellido = apellido || user.apellido;
        res.json(user);
    }
    else {
        res.status(404).json({ error: 'Usuario no encontrado' });
    }
}

function deleteUser(req, res) {
    const userId = parseInt(req.params.id);
    const userIndex = data.users.findIndex(u => u.id === userId);
    if (userIndex !== -1) {
        const deletedUser = data.users.splice(userIndex, 1);
        res.json(deletedUser[0]);
    }
    else {
        res.status(404).json({ error: 'Usuario no encontrado' });
    }
}

export { getUsers, getUserById, createUser, updateUser, deleteUser };