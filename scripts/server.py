from flask import Flask, request
from flask_restful import Resource, Api
from flask_cors import CORS
from sqlalchemy import create_engine
from json import dumps
from devicedb import devicedb

app = Flask(__name__)
CORS(app)
api = Api(app)
devicedb = devicedb()

class Boards(Resource):
    def get(self):
        return devicedb.get_boards()

class Devices(Resource):
    def get(self):
        return devicedb.get_devices()

class Samples(Resource):
    def get(self):
        return devicedb.get_samples()

class Config(Resource):
    def get(self):
        return devicedb.get_config()

class Bindings(Resource):
    def get(self):
        return devicedb.get_bindings()


api.add_resource(Boards, '/boards')
api.add_resource(Devices, '/devices')
api.add_resource(Samples, '/samples')
api.add_resource(Config, '/config')
api.add_resource(Bindings, '/bindings')

if __name__ == '__main__':
    devicedb.load_db('/home/ted/repo/nrf_connect/fw-nrfconnect-zephyr/')
    app.run(host='0.0.0.0', port='5002')
