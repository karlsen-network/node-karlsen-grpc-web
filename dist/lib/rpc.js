var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { FlowGRPCWeb, dpc, clearDPC } from '@aspectron/flow-grpc-web';
export const Deferred = () => {
    let methods = {};
    let promise = new Promise((resolve, reject) => {
        methods = { resolve, reject };
    });
    Object.assign(promise, methods);
    return promise;
};
export class RPC {
    constructor(options = {}) {
        this.isReady = false;
        this.queue = [];
        this.reconnect = true;
        this.verbose = false;
        this.subscribers = new Map();
        this.isConnected = false;
        this.connectCBs = [];
        this.connectFailureCBs = [];
        this.errorCBs = [];
        this.disconnectCBs = [];
        this.options = Object.assign({
            reconnect: true,
            verbose: false,
            uid: (Math.random() * 1000).toFixed(0)
        }, options || {});
        this.log = Function.prototype.bind.call(console.log, console, `[Kaspa gRPC ${this.options.uid}]:`);
        this.pending = {};
        this.reconnect = this.options.reconnect;
        this.client = new FlowGRPCWeb(options.clientConfig || {});
        this.serviceClientSignal = Deferred();
        this.client.on("ready", (clients) => {
            console.log("gRPCWeb::::clients", clients);
            let { RPC } = clients;
            this.serviceClient = RPC;
            this.serviceClientSignal.resolve();
            /*
            const stream = RPC.MessageStream();
            this.stream = stream;
            console.log("stream", stream)
            stream.on("end", ()=>{
                console.log("stream end")
            });
            this.initIntake(stream);
            */
        });
        this.connect();
    }
    getServiceClient() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.serviceClientSignal;
            return this.serviceClient;
        });
    }
    connect() {
        this.reconnect = true;
        return this._connect();
    }
    _connect() {
        return __awaiter(this, void 0, void 0, function* () {
            // this.reconnect = true;
            this.verbose && this.log('gRPC Client connecting to', this.options.host);
            const RPC = yield this.getServiceClient();
            this.stream = RPC.MessageStream();
            this.initIntake(this.stream);
            this.isReady = true;
            this.processQueue();
            const reconnect = () => {
                this._setConnected(false);
                if (this.reconnect_dpc) {
                    clearDPC(this.reconnect_dpc);
                    delete this.reconnect_dpc;
                }
                this.clearPending();
                delete this.stream;
                //delete this.client;
                if (this.reconnect) {
                    this.reconnect_dpc = dpc(1000, () => {
                        this._connect();
                    });
                }
            };
            this.stream.on('error', (error) => {
                // console.log("client:",error);
                this.errorCBs.forEach(fn => fn(error.toString(), error));
                this.verbose && this.log('stream:error', error);
                reconnect();
            });
            this.stream.on('end', (...args) => {
                this.verbose && this.log('stream:end', ...args);
                reconnect();
            });
            yield new Promise((resolve) => {
                dpc(100, () => __awaiter(this, void 0, void 0, function* () {
                    let response = yield this.request('getVirtualSelectedParentBlueScoreRequest', {})
                        .catch(e => {
                        this.connectFailureCBs.forEach(fn => fn(e));
                    });
                    this.verbose && this.log("getVirtualSelectedParentBlueScoreRequest:response", response);
                    if (response && response.blueScore) {
                        this._setConnected(true);
                    }
                    resolve();
                }));
            });
        });
    }
    initIntake(stream) {
        stream.on('data', (data) => {
            if (data.payload) {
                let name = data.payload;
                let payload = data[name];
                let ident = name.replace(/^get|Response$/ig, '').toLowerCase();
                this.handleIntake({ name, payload, ident });
            }
        });
    }
    handleIntake(o) {
        if (this.intakeHandler) {
            this.intakeHandler(o);
        }
        else {
            let handlers = this.pending[o.name];
            this.verbose && console.log('intake:', o, 'handlers:', handlers);
            if (handlers && handlers.length) {
                let pendingItem = handlers.shift();
                if (pendingItem)
                    pendingItem.resolve(o.payload);
            }
            let subscribers = this.subscribers.get(o.name);
            if (subscribers) {
                subscribers.map(subscriber => {
                    subscriber.callback(o.payload);
                });
            }
        }
    }
    setIntakeHandler(fn) {
        this.intakeHandler = fn;
    }
    processQueue() {
        if (!this.isReady)
            return;
        let item = this.queue.shift();
        while (item) {
            const resp = item.method.replace(/Request$/, 'Response');
            if (!this.pending[resp])
                this.pending[resp] = [];
            let handlers = this.pending[resp];
            handlers.push(item);
            let req = {};
            req[item.method] = item.data;
            this.stream.write(req);
            item = this.queue.shift();
        }
    }
    clearPending() {
        Object.keys(this.pending).forEach(key => {
            let list = this.pending[key];
            list.forEach(o => o.reject('closing by force'));
            this.pending[key] = [];
        });
    }
    _setConnected(isConnected) {
        if (this.isConnected == isConnected)
            return;
        this.isConnected = isConnected;
        let cbs = isConnected ? this.connectCBs : this.disconnectCBs;
        //console.log("this.isConnected", this.isConnected, cbs)
        cbs.forEach(fn => {
            fn();
        });
    }
    onConnect(callback) {
        this.connectCBs.push(callback);
        if (this.isConnected)
            callback();
    }
    onConnectFailure(callback) {
        this.connectFailureCBs.push(callback);
    }
    onError(callback) {
        this.errorCBs.push(callback);
    }
    onDisconnect(callback) {
        this.disconnectCBs.push(callback);
    }
    disconnect() {
        if (this.reconnect_dpc) {
            clearDPC(this.reconnect_dpc);
            delete this.reconnect_dpc;
        }
        this.reconnect = false;
        this.stream && this.stream.end();
        this.clearPending();
    }
    request(method, data) {
        return new Promise((resolve, reject) => {
            this.queue.push({ method, data, resolve, reject });
            this.processQueue();
        });
    }
    subscribe(subject, data = {}, callback) {
        if (typeof data == 'function') {
            callback = data;
            data = {};
        }
        if (!this.client)
            return Promise.reject('not connected');
        let eventName = this.subject2EventName(subject);
        console.log("subscribe:eventName", eventName);
        let subscribers = this.subscribers.get(eventName);
        if (!subscribers) {
            subscribers = [];
            this.subscribers.set(eventName, subscribers);
        }
        let uid = (Math.random() * 100000 + Date.now()).toFixed(0);
        subscribers.push({ uid, callback });
        let p = this.request(subject, data);
        p.uid = uid;
        return p;
    }
    subject2EventName(subject) {
        let eventName = subject.replace("notify", "").replace("Request", "Notification");
        return eventName[0].toLowerCase() + eventName.substr(1);
    }
    unSubscribe(subject, uid = '') {
        let eventName = this.subject2EventName(subject);
        let subscribers = this.subscribers.get(eventName);
        if (!subscribers)
            return;
        if (!uid) {
            this.subscribers.delete(eventName);
        }
        else {
            subscribers = subscribers.filter(sub => sub.uid != uid);
            this.subscribers.set(eventName, subscribers);
        }
    }
    subscribeChainChanged(callback) {
        return this.subscribe("notifyChainChangedRequest", {}, callback);
    }
    subscribeBlockAdded(callback) {
        return this.subscribe("notifyBlockAddedRequest", {}, callback);
    }
    subscribeVirtualSelectedParentBlueScoreChanged(callback) {
        return this.subscribe("notifyVirtualSelectedParentBlueScoreChangedRequest", {}, callback);
    }
    subscribeUtxosChanged(addresses, callback) {
        return this.subscribe("notifyUtxosChangedRequest", { addresses }, callback);
    }
    unSubscribeUtxosChanged(uid = '') {
        this.unSubscribe("notifyUtxosChangedRequest", uid);
    }
    getBlock(hash) {
        return this.request('getBlockRequest', { hash, includeBlockVerboseData: true });
    }
    getTransactionsByAddresses(startingBlockHash, addresses) {
        return this.request('getTransactionsByAddressesRequest', {
            startingBlockHash, addresses
        });
    }
    getUtxosByAddresses(addresses) {
        return this.request('getUtxosByAddressesRequest', { addresses });
    }
    submitTransaction(tx) {
        return this.request('submitTransactionRequest', tx);
    }
    getVirtualSelectedParentBlueScore() {
        return this.request('getVirtualSelectedParentBlueScoreRequest', {});
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicnBjLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vbGliL3JwYy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7QUFBQSxPQUFPLEVBQUMsV0FBVyxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUMsTUFBTSwwQkFBMEIsQ0FBQztBQVdwRSxNQUFNLENBQUMsTUFBTSxRQUFRLEdBQUcsR0FBbUIsRUFBRTtJQUN6QyxJQUFJLE9BQU8sR0FBRyxFQUFFLENBQUM7SUFDakIsSUFBSSxPQUFPLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFDLEVBQUU7UUFDekMsT0FBTyxHQUFHLEVBQUMsT0FBTyxFQUFFLE1BQU0sRUFBQyxDQUFDO0lBQ2hDLENBQUMsQ0FBQyxDQUFBO0lBQ0YsTUFBTSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7SUFDaEMsT0FBTyxPQUEwQixDQUFDO0FBQ3RDLENBQUMsQ0FBQTtBQUVELE1BQU0sT0FBTyxHQUFHO0lBcUJmLFlBQVksVUFBWSxFQUFFO1FBcEIxQixZQUFPLEdBQVcsS0FBSyxDQUFDO1FBS3hCLFVBQUssR0FBZSxFQUFFLENBQUM7UUFHdkIsY0FBUyxHQUFXLElBQUksQ0FBQztRQUN6QixZQUFPLEdBQVcsS0FBSyxDQUFDO1FBQ3hCLGdCQUFXLEdBQXNCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDM0MsZ0JBQVcsR0FBUyxLQUFLLENBQUM7UUFDMUIsZUFBVSxHQUFjLEVBQUUsQ0FBQztRQUMzQixzQkFBaUIsR0FBYyxFQUFFLENBQUM7UUFDbEMsYUFBUSxHQUFjLEVBQUUsQ0FBQztRQUN6QixrQkFBYSxHQUFjLEVBQUUsQ0FBQztRQU03QixJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7WUFDNUIsU0FBUyxFQUFFLElBQUk7WUFDZixPQUFPLEVBQUcsS0FBSztZQUNmLEdBQUcsRUFBQyxDQUFDLElBQUksQ0FBQyxN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LFNBQWtCO1FBQ3RFLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBc0MsbUNBQW1DLEVBQUU7WUFDN0YsaUJBQWlCLEVBQUUsU0FBUztTQUM1QixDQUFDLENBQUM7SUFDSixDQUFDO0lBQ0QsbUJBQW1CLENBQUMsU0FBa0I7UUFDckMsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUErQiw0QkFBNEIsRUFBRSxFQUFDLFNBQVMsRUFBQyxDQUFDLENBQUM7SUFDOUYsQ0FBQztJQUNELGlCQUFpQixDQUFDLEVBQWdDO1FBQ2pELE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBZ0MsMEJBQTBCLEVBQUUsRUFBRSxDQUFDLENBQUM7SUFDcEYsQ0FBQztJQUVELGlDQUFpQztRQUNoQyxPQUFPLElBQUksQ0FBQyxPQUFPLENBQTZDLDBDQUEwQyxFQUFFLEVBQUUsQ0FBQyxDQUFDO0lBQ2pILENBQUM7Q0FDRCIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7Rmxvd0dSUENXZWIsIGRwYywgY2xlYXJEUEN9IGZyb20gJ0Bhc3BlY3Ryb24vZmxvdy1ncnBjLXdlYic7XG4vL2NvbnN0IEZsb3dHUlBDV2ViID0gbmV3IEZsb3dHUlBDV2ViKCk7XG5pbXBvcnQge0lSUEMsIFJQQyBhcyBScGMsXG5cdFN1YnNjcmliZXJJdGVtLCBTdWJzY3JpYmVySXRlbU1hcCxcblx0UXVldWVJdGVtLCBQZW5kaW5nUmVxcywgSURhdGEsIElTdHJlYW1cbn0gZnJvbSAnLi4vdHlwZXMvY3VzdG9tLXR5cGVzJztcblxuZXhwb3J0IGludGVyZmFjZSBEZWZlcnJlZFByb21pc2UgZXh0ZW5kcyBQcm9taXNlPGFueT4ge1xuICAgIHJlc29sdmUoZGF0YT86YW55KTp2b2lkO1xuICAgIHJlamVjdChlcnJvcj86YW55KTp2b2lkO1xufVxuZXhwb3J0IGNvbnN0IERlZmVycmVkID0gKCk6IERlZmVycmVkUHJvbWlzZT0+e1xuICAgIGxldCBtZXRob2RzID0ge307XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KT0+e1xuICAgICAgICBtZXRob2RzID0ge3Jlc29sdmUsIHJlamVjdH07XG4gICAgfSlcbiAgICBPYmplY3QuYXNzaWduKHByb21pc2UsIG1ldGhvZHMpO1xuICAgIHJldHVybiBwcm9taXNlIGFzIERlZmVycmVkUHJvbWlzZTtcbn1cblxuZXhwb3J0IGNsYXNzIFJQQyBpbXBsZW1lbnRzIElSUEN7XG5cdGlzUmVhZHk6Ym9vbGVhbiA9IGZhbHNlO1xuXHRvcHRpb25zOmFueTtcblx0Y2xpZW50OkZsb3dHUlBDV2ViO1xuXHRyZWNvbm5lY3RfZHBjOm51bWJlcnx1bmRlZmluZWQ7XG5cdHN0cmVhbTpJU3RyZWFtO1xuXHRxdWV1ZTpRdWV1ZUl0ZW1bXSA9IFtdO1xuXHRwZW5kaW5nOlBlbmRpbmdSZXFzO1xuXHRpbnRha2VIYW5kbGVyOkZ1bmN0aW9ufHVuZGVmaW5lZDtcblx0cmVjb25uZWN0OmJvb2xlYW4gPSB0cnVlO1xuXHR2ZXJib3NlOmJvb2xlYW4gPSBmYWxzZTtcblx0c3Vic2NyaWJlcnM6IFN1YnNjcmliZXJJdGVtTWFwID0gbmV3IE1hcCgpO1xuXHRpc0Nvbm5lY3RlZDpib29sZWFuPWZhbHNlO1xuXHRjb25uZWN0Q0JzOkZ1bmN0aW9uW10gPSBbXTtcblx0Y29ubmVjdEZhaWx1cmVDQnM6RnVuY3Rpb25bXSA9IFtdO1xuXHRlcnJvckNCczpGdW5jdGlvbltdID0gW107XG5cdGRpc2Nvbm5lY3RDQnM6RnVuY3Rpb25bXSA9IFtdO1xuXHRzZXJ2aWNlQ2xpZW50OmFueTtcblx0c2VydmljZUNsaWVudFNpZ25hbDogRGVmZXJyZWRQcm9taXNlO1xuXHRsb2c6RnVuY3Rpb247XG5cblx0Y29uc3RydWN0b3Iob3B0aW9uczphbnk9e30pe1xuXHRcdHRoaXMub3B0aW9ucyA9IE9iamVjdC5hc3NpZ24oe1xuXHRcdFx0cmVjb25uZWN0OiB0cnVlLFxuXHRcdFx0dmVyYm9zZSA6IGZhbHNlLFxuXHRcdFx0dWlkOihNYXRoLnJhbmRvbSgpKjEwMDApLnRvRml4ZWQoMClcblx0XHR9LCBvcHRpb25zfHx7fSk7XG5cblx0XHR0aGlzLmxvZyA9IEZ1bmN0aW9uLnByb3RvdHlwZS5iaW5kLmNhbGwoXG5cdFx0XHRjb25zb2xlLmxvZyxcblx0XHRcdGNvbnNvbGUsXG5cdFx0XHRgW0thc3BhIGdSUEMgJHt0aGlzLm9wdGlvbnMudWlkfV06YFxuXHRcdCk7XG5cblx0XHR0aGlzLnBlbmRpbmcgPSB7fTtcblx0XHR0aGlzLnJlY29ubmVjdCA9IHRoaXMub3B0aW9ucy5yZWNvbm5lY3Q7XG5cdFx0dGhpcy5jbGllbnQgPSBuZXcgRmxvd0dSUENXZWIob3B0aW9ucy5jbGllbnRDb25maWd8fHt9KTtcblxuXHRcdHRoaXMuc2VydmljZUNsaWVudFNpZ25hbCA9IERlZmVycmVkKCk7XG5cblx0XHR0aGlzLmNsaWVudC5vbihcInJlYWR5XCIsIChjbGllbnRzOmFueSk9Pntcblx0XHRcdGNvbnNvbGUubG9nKFwiZ1JQQ1dlYjo6OjpjbGllbnRzXCIsIGNsaWVudHMpXG5cdFx0XHRsZXQge1JQQ30gPSBjbGllbnRzO1xuXHRcdFx0dGhpcy5zZXJ2aWNlQ2xpZW50ID0gUlBDO1xuXHRcdFx0dGhpcy5zZXJ2aWNlQ2xpZW50U2lnbmFsLnJlc29sdmUoKTtcblxuXHRcdFx0Lypcblx0XHRcdGNvbnN0IHN0cmVhbSA9IFJQQy5NZXNzYWdlU3RyZWFtKCk7XG5cdFx0XHR0aGlzLnN0cmVhbSA9IHN0cmVhbTtcblx0XHRcdGNvbnNvbGUubG9nKFwic3RyZWFtXCIsIHN0cmVhbSlcblx0XHRcdHN0cmVhbS5vbihcImVuZFwiLCAoKT0+e1xuXHRcdFx0XHRjb25zb2xlLmxvZyhcInN0cmVhbSBlbmRcIilcblx0XHRcdH0pO1xuXHRcdFx0dGhpcy5pbml0SW50YWtlKHN0cmVhbSk7XG5cdFx0XHQqL1xuXHRcdH0pXG5cdFx0dGhpcy5jb25uZWN0KCk7XG5cdH1cblx0YXN5bmMgZ2V0U2VydmljZUNsaWVudCgpe1xuXHRcdGF3YWl0IHRoaXMuc2VydmljZUNsaWVudFNpZ25hbDtcblx0XHRyZXR1cm4gdGhpcy5zZXJ2aWNlQ2xpZW50O1xuXHR9XG5cdGNvbm5lY3QoKXtcblx0XHR0aGlzLnJlY29ubmVjdCA9IHRydWU7XG5cdFx0cmV0dXJuIHRoaXMuX2Nvbm5lY3QoKTtcblx0fVxuXHRhc3luYyBfY29ubmVjdCgpIHtcblx0XHQvLyB0aGlzLnJlY29ubmVjdCA9IHRydWU7XG5cdFx0dGhpcy52ZXJib3NlICYmIHRoaXMubG9nKCdnUlBDIENsaWVudCBjb25uZWN0aW5nIHRvJywgdGhpcy5vcHRpb25zLmhvc3QpO1xuXHRcdGNvbnN0IFJQQyA9IGF3YWl0IHRoaXMuZ2V0U2VydmljZUNsaWVudCgpO1xuXG5cdFx0dGhpcy5zdHJlYW0gPSBSUEMuTWVzc2FnZVN0cmVhbSgpO1xuXHRcdHRoaXMuaW5pdEludGFrZSh0aGlzLnN0cmVhbSk7XG5cdFx0dGhpcy5pc1JlYWR5ID0gdHJ1ZTtcblx0XHR0aGlzLnByb2Nlc3NRdWV1ZSgpO1xuXG5cdFx0Y29uc3QgcmVjb25uZWN0ID0gKCkgPT4ge1xuXHRcdFx0dGhpcy5fc2V0Q29ubmVjdGVkKGZhbHNlKTtcblx0XHRcdGlmKHRoaXMucmVjb25uZWN0X2RwYykge1xuXHRcdFx0XHRjbGVhckRQQyh0aGlzLnJlY29ubmVjdF9kcGMpO1xuXHRcdFx0XHRkZWxldGUgdGhpcy5yZWNvbm5lY3RfZHBjO1xuXHRcdFx0fVxuXG5cdFx0XHR0aGlzLmNsZWFyUGVuZGluZygpO1xuXHRcdFx0ZGVsZXRlIHRoaXMuc3RyZWFtO1xuXHRcdFx0Ly9kZWxldGUgdGhpcy5jbGllbnQ7XG5cdFx0XHRpZih0aGlzLnJlY29ubmVjdCkge1xuXHRcdFx0XHR0aGlzLnJlY29ubmVjdF9kcGMgPSBkcGMoMTAwMCwgKCkgPT4ge1xuXHRcdFx0XHRcdHRoaXMuX2Nvbm5lY3QoKTtcblx0XHRcdFx0fSlcblx0XHRcdH1cblx0XHR9XG5cdFx0dGhpcy5zdHJlYW0ub24oJ2Vycm9yJywgKGVycm9yOmFueSkgPT4ge1xuXHRcdFx0Ly8gY29uc29sZS5sb2coXCJjbGllbnQ6XCIsZXJyb3IpO1xuXHRcdFx0dGhpcy5lcnJvckNCcy5mb3JFYWNoKGZuPT5mbihlcnJvci50b1N0cmluZygpLCBlcnJvcikpO1xuXHRcdFx0dGhpcy52ZXJib3NlICYmIHRoaXMubG9nKCdzdHJlYW06ZXJyb3InLCBlcnJvcik7XG5cdFx0XHRyZWNvbm5lY3QoKTtcblx0XHR9KVxuXHRcdHRoaXMuc3RyZWFtLm9uKCdlbmQnLCAoLi4uYXJnczphbnkpID0+IHtcblx0XHRcdHRoaXMudmVyYm9zZSAmJiB0aGlzLmxvZygnc3RyZWFtOmVuZCcsIC4uLmFyZ3MpO1xuXHRcdFx0cmVjb25uZWN0KCk7XG5cdFx0fSk7XG5cblx0XHRhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSk9Pntcblx0XHRcdGRwYygxMDAsIGFzeW5jKCk9Pntcblx0XHRcdFx0bGV0IHJlc3BvbnNlOmFueSA9IGF3YWl0IHRoaXMucmVxdWVzdCgnZ2V0VmlydHVhbFNlbGVjdGVkUGFyZW50Qmx1ZVNjb3JlUmVxdWVzdCcsIHt9KVxuXHRcdFx0XHQuY2F0Y2goZT0+e1xuXHRcdFx0XHRcdHRoaXMuY29ubmVjdEZhaWx1cmVDQnMuZm9yRWFjaChmbj0+Zm4oZSkpO1xuXHRcdFx0XHR9KVxuXHRcdFx0XHR0aGlzLnZlcmJvc2UgJiYgdGhpcy5sb2coXCJnZXRWaXJ0dWFsU2VsZWN0ZWRQYXJlbnRCbHVlU2NvcmVSZXF1ZXN0OnJlc3BvbnNlXCIsIHJlc3BvbnNlKVxuXHRcdFx0XHRpZihyZXNwb25zZSAmJiByZXNwb25zZS5ibHVlU2NvcmUpe1xuXHRcdFx0XHRcdHRoaXMuX3NldENvbm5lY3RlZCh0cnVlKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRyZXNvbHZlKCk7XG5cdFx0XHR9KVxuXHRcdH0pXG5cdH1cblx0aW5pdEludGFrZShzdHJlYW06SVN0cmVhbSkge1xuICAgICAgICBzdHJlYW0ub24oJ2RhdGEnLChkYXRhOmFueSkgPT4ge1xuICAgICAgICAgICAgaWYoZGF0YS5wYXlsb2FkKSB7XG4gICAgICAgICAgICAgICAgbGV0IG5hbWUgPSBkYXRhLnBheWxvYWQ7XG4gICAgICAgICAgICAgICAgbGV0IHBheWxvYWQgPSBkYXRhW25hbWVdO1xuICAgICAgICAgICAgICAgIGxldCBpZGVudCA9IG5hbWUucmVwbGFjZSgvXmdldHxSZXNwb25zZSQvaWcsJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgICAgICAgICAgdGhpcy5oYW5kbGVJbnRha2Uoe25hbWUsIHBheWxvYWQsIGlkZW50fSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICBoYW5kbGVJbnRha2UobzpJRGF0YSkge1xuICAgICAgICBpZih0aGlzLmludGFrZUhhbmRsZXIpIHtcbiAgICAgICAgICAgIHRoaXMuaW50YWtlSGFuZGxlcihvKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBoYW5kbGVycyA9IHRoaXMucGVuZGluZ1tvLm5hbWVdO1xuICAgICAgICAgICAgdGhpcy52ZXJib3NlICYmIGNvbnNvbGUubG9nKCdpbnRha2U6JyxvLCdoYW5kbGVyczonLGhhbmRsZXJzKTtcbiAgICAgICAgICAgIGlmKGhhbmRsZXJzICYmIGhhbmRsZXJzLmxlbmd0aCl7XG4gICAgICAgICAgICBcdGxldCBwZW5kaW5nSXRlbTpRdWV1ZUl0ZW18dW5kZWZpbmVkID0gaGFuZGxlcnMuc2hpZnQoKTtcbiAgICAgICAgICAgIFx0aWYocGVuZGluZ0l0ZW0pXG4gICAgICAgICAgICAgICAgXHRwZW5kaW5nSXRlbS5yZXNvbHZlKG8ucGF5bG9hZCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGxldCBzdWJzY3JpYmVyczpTdWJzY3JpYmVySXRlbVtdfHVuZGVmaW5lZCA9IHRoaXMuc3Vic2NyaWJlcnMuZ2V0KG8ubmFtZSk7XG5cdFx0XHRpZihzdWJzY3JpYmVycyl7XG5cdFx0XHRcdHN1YnNjcmliZXJzLm1hcChzdWJzY3JpYmVyPT57XG5cdFx0XHRcdFx0c3Vic2NyaWJlci5jYWxsYmFjayhvLnBheWxvYWQpXG5cdFx0XHRcdH0pXG5cdFx0XHR9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBzZXRJbnRha2VIYW5kbGVyKGZuOkZ1bmN0aW9uKSB7XG4gICAgICAgIHRoaXMuaW50YWtlSGFuZGxlciA9IGZuO1xuICAgIH1cblx0cHJvY2Vzc1F1ZXVlKCl7XG5cdFx0aWYoIXRoaXMuaXNSZWFkeSlcblx0XHRcdHJldHVyblxuXG5cdFx0bGV0IGl0ZW06UXVldWVJdGVtfHVuZGVmaW5lZCA9IHRoaXMucXVldWUuc2hpZnQoKTtcblx0XHR3aGlsZShpdGVtKXtcblx0XHRcdGNvbnN0IHJlc3AgPSBpdGVtLm1ldGhvZC5yZXBsYWNlKC9SZXF1ZXN0JC8sJ1Jlc3BvbnNlJyk7XG4gICAgICAgICAgICBpZighdGhpcy5wZW5kaW5nW3Jlc3BdKVxuICAgICAgICAgICAgICAgIHRoaXMucGVuZGluZ1tyZXNwXSA9IFtdO1xuICAgICAgICAgICAgbGV0IGhhbmRsZXJzOlF1ZXVlSXRlbVtdID0gdGhpcy5wZW5kaW5nW3Jlc3BdO1xuICAgICAgICAgICAgaGFuZGxlcnMucHVzaChpdGVtKTtcblxuXHRcdFx0bGV0IHJlcTphbnkgPSB7fTtcblx0XHRcdHJlcVtpdGVtLm1ldGhvZF0gPSBpdGVtLmRhdGE7XG5cdFx0XHR0aGlzLnN0cmVhbS53cml0ZShyZXEpO1xuXG5cdFx0XHRpdGVtID0gdGhpcy5xdWV1ZS5zaGlmdCgpO1xuXHRcdH1cblx0fVxuXHRjbGVhclBlbmRpbmcoKSB7XG4gICAgICAgIE9iamVjdC5rZXlzKHRoaXMucGVuZGluZykuZm9yRWFjaChrZXkgPT4ge1xuICAgICAgICAgICAgbGV0IGxpc3QgPSB0aGlzLnBlbmRpbmdba2V5XTtcbiAgICAgICAgICAgIGxpc3QuZm9yRWFjaChvPT5vLnJlamVjdCgnY2xvc2luZyBieSBmb3JjZScpKTtcbiAgICAgICAgICAgIHRoaXMucGVuZGluZ1trZXldID0gW107XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9zZXRDb25uZWN0ZWQoaXNDb25uZWN0ZWQ6Ym9vbGVhbil7XG5cdFx0aWYodGhpcy5pc0Nvbm5lY3RlZCA9PSBpc0Nvbm5lY3RlZClcblx0XHRcdHJldHVybjtcblx0XHR0aGlzLmlzQ29ubmVjdGVkID0gaXNDb25uZWN0ZWQ7XG5cblx0XHRsZXQgY2JzID0gaXNDb25uZWN0ZWQ/dGhpcy5jb25uZWN0Q0JzOnRoaXMuZGlzY29ubmVjdENCcztcblx0XHQvL2NvbnNvbGUubG9nKFwidGhpcy5pc0Nvbm5lY3RlZFwiLCB0aGlzLmlzQ29ubmVjdGVkLCBjYnMpXG5cdFx0Y2JzLmZvckVhY2goZm49Pntcblx0XHRcdGZuKCk7XG5cdFx0fSlcblx0fVxuXG5cdG9uQ29ubmVjdChjYWxsYmFjazpGdW5jdGlvbil7XG5cdFx0dGhpcy5jb25uZWN0Q0JzLnB1c2goY2FsbGJhY2spXG5cdFx0aWYodGhpcy5pc0Nvbm5lY3RlZClcblx0XHRcdGNhbGxiYWNrKCk7XG5cdH1cblx0b25Db25uZWN0RmFpbHVyZShjYWxsYmFjazpGdW5jdGlvbil7XG5cdFx0dGhpcy5jb25uZWN0RmFpbHVyZUNCcy5wdXNoKGNhbGxiYWNrKVxuXHR9XG5cdG9uRXJyb3IoY2FsbGJhY2s6RnVuY3Rpb24pe1xuXHRcdHRoaXMuZXJyb3JDQnMucHVzaChjYWxsYmFjaylcblx0fVxuXHRvbkRpc2Nvbm5lY3QoY2FsbGJhY2s6RnVuY3Rpb24pe1xuXHRcdHRoaXMuZGlzY29ubmVjdENCcy5wdXNoKGNhbGxiYWNrKVxuXHR9XG5cblx0ZGlzY29ubmVjdCgpIHtcblx0XHRpZih0aGlzLnJlY29ubmVjdF9kcGMpIHtcblx0XHRcdGNsZWFyRFBDKHRoaXMucmVjb25uZWN0X2RwYyk7XG5cdFx0XHRkZWxldGUgdGhpcy5yZWNvbm5lY3RfZHBjO1xuXHRcdH1cblx0XHR0aGlzLnJlY29ubmVjdCA9IGZhbHNlO1xuXHRcdHRoaXMuc3RyZWFtICYmIHRoaXMuc3RyZWFtLmVuZCgpO1xuXHRcdHRoaXMuY2xlYXJQZW5kaW5nKCk7XG5cdH1cblx0cmVxdWVzdDxUPihtZXRob2Q6c3RyaW5nLCBkYXRhOmFueSl7XG5cdFx0cmV0dXJuIG5ldyBQcm9taXNlPFQ+KChyZXNvbHZlLCByZWplY3QpPT57XG5cdFx0XHR0aGlzLnF1ZXVlLnB1c2goe21ldGhvZCwgZGF0YSwgcmVzb2x2ZSwgcmVqZWN0fSk7XG5cdFx0XHR0aGlzLnByb2Nlc3NRdWV1ZSgpO1xuXHRcdH0pXG5cdH1cbiAgICBzdWJzY3JpYmU8VCwgUj4oc3ViamVjdDpzdHJpbmcsIGRhdGE6YW55PXt9LCBjYWxsYmFjazpScGMuY2FsbGJhY2s8Uj4pOlJwYy5TdWJQcm9taXNlPFQ+e1xuXHRcdGlmKHR5cGVvZiBkYXRhID09ICdmdW5jdGlvbicpe1xuXHRcdFx0Y2FsbGJhY2sgPSBkYXRhO1xuXHRcdFx0ZGF0YSA9IHt9O1xuXHRcdH1cblxuXHRcdGlmKCF0aGlzLmNsaWVudClcblx0XHRcdHJldHVybiBQcm9taXNlLnJlamVjdCgnbm90IGNvbm5lY3RlZCcpIGFzIFJwYy5TdWJQcm9taXNlPFQ+O1xuXG5cdFx0bGV0IGV2ZW50TmFtZSA9IHRoaXMuc3ViamVjdDJFdmVudE5hbWUoc3ViamVjdCk7XG5cdFx0Y29uc29sZS5sb2coXCJzdWJzY3JpYmU6ZXZlbnROYW1lXCIsIGV2ZW50TmFtZSlcblxuXHRcdGxldCBzdWJzY3JpYmVyczpTdWJzY3JpYmVySXRlbVtdfHVuZGVmaW5lZCA9IHRoaXMuc3Vic2NyaWJlcnMuZ2V0KGV2ZW50TmFtZSk7XG5cdFx0aWYoIXN1YnNjcmliZXJzKXtcblx0XHRcdHN1YnNjcmliZXJzID0gW107XG5cdFx0XHR0aGlzLnN1YnNjcmliZXJzLnNldChldmVudE5hbWUsIHN1YnNjcmliZXJzKTtcblx0XHR9XG5cdFx0bGV0IHVpZCA9IChNYXRoLnJhbmRvbSgpKjEwMDAwMCArIERhdGUubm93KCkpLnRvRml4ZWQoMCk7XG5cdFx0c3Vic2NyaWJlcnMucHVzaCh7dWlkLCBjYWxsYmFja30pO1xuXG5cdFx0bGV0IHAgPSB0aGlzLnJlcXVlc3Qoc3ViamVjdCwgZGF0YSkgYXMgUnBjLlN1YlByb21pc2U8VD47XG5cblx0XHRwLnVpZCA9IHVpZDtcblx0XHRyZXR1cm4gcDtcblx0fVxuXHRzdWJqZWN0MkV2ZW50TmFtZShzdWJqZWN0OnN0cmluZyl7XG5cdFx0bGV0IGV2ZW50TmFtZSA9IHN1YmplY3QucmVwbGFjZShcIm5vdGlmeVwiLCBcIlwiKS5yZXBsYWNlKFwiUmVxdWVzdFwiLCBcIk5vdGlmaWNhdGlvblwiKVxuXHRcdHJldHVybiBldmVudE5hbWVbMF0udG9Mb3dlckNhc2UoKStldmVudE5hbWUuc3Vic3RyKDEpO1xuXHR9XG5cblx0dW5TdWJzY3JpYmUoc3ViamVjdDpzdHJpbmcsIHVpZDpzdHJpbmc9Jycpe1xuXHRcdGxldCBldmVudE5hbWUgPSB0aGlzLnN1YmplY3QyRXZlbnROYW1lKHN1YmplY3QpO1xuXHRcdGxldCBzdWJzY3JpYmVyczpTdWJzY3JpYmVySXRlbVtdfHVuZGVmaW5lZCA9IHRoaXMuc3Vic2NyaWJlcnMuZ2V0KGV2ZW50TmFtZSk7XG5cdFx0aWYoIXN1YnNjcmliZXJzKVxuXHRcdFx0cmV0dXJuXG5cdFx0aWYoIXVpZCl7XG5cdFx0XHR0aGlzLnN1YnNjcmliZXJzLmRlbGV0ZShldmVudE5hbWUpO1xuXHRcdH1lbHNle1xuXHRcdFx0c3Vic2NyaWJlcnMgPSBzdWJzY3JpYmVycy5maWx0ZXIoc3ViPT5zdWIudWlkIT11aWQpXG5cdFx0XHR0aGlzLnN1YnNjcmliZXJzLnNldChldmVudE5hbWUsIHN1YnNjcmliZXJzKTtcblx0XHR9XG5cdH1cblxuXHRzdWJzY3JpYmVDaGFpbkNoYW5nZWQoY2FsbGJhY2s6UnBjLmNhbGxiYWNrPFJwYy5DaGFpbkNoYW5nZWROb3RpZmljYXRpb24+KXtcblx0XHRyZXR1cm4gdGhpcy5zdWJzY3JpYmU8UnBjLk5vdGlmeUNoYWluQ2hhbmdlZFJlc3BvbnNlLCBScGMuQ2hhaW5DaGFuZ2VkTm90aWZpY2F0aW9uPihcIm5vdGlmeUNoYWluQ2hhbmdlZFJlcXVlc3RcIiwge30sIGNhbGxiYWNrKTtcblx0fVxuXHRzdWJzY3JpYmVCbG9ja0FkZGVkKGNhbGxiYWNrOlJwYy5jYWxsYmFjazxScGMuQmxvY2tBZGRlZE5vdGlmaWNhdGlvbj4pe1xuXHRcdHJldHVybiB0aGlzLnN1YnNjcmliZTxScGMuTm90aWZ5QmxvY2tBZGRlZFJlc3BvbnNlLCBScGMuQmxvY2tBZGRlZE5vdGlmaWNhdGlvbj4oXCJub3RpZnlCbG9ja0FkZGVkUmVxdWVzdFwiLCB7fSwgY2FsbGJhY2spO1xuXHR9XG5cdHN1YnNjcmliZVZpcnR1YWxTZWxlY3RlZFBhcmVudEJsdWVTY29yZUNoYW5nZWQoY2FsbGJhY2s6UnBjLmNhbGxiYWNrPFJwYy5WaXJ0dWFsU2VsZWN0ZWRQYXJlbnRCbHVlU2NvcmVDaGFuZ2VkTm90aWZpY2F0aW9uPil7XG5cdFx0cmV0dXJuIHRoaXMuc3Vic2NyaWJlPFJwYy5Ob3RpZnlWaXJ0dWFsU2VsZWN0ZWRQYXJlbnRCbHVlU2NvcmVDaGFuZ2VkUmVzcG9uc2UsIFJwYy5WaXJ0dWFsU2VsZWN0ZWRQYXJlbnRCbHVlU2NvcmVDaGFuZ2VkTm90aWZpY2F0aW9uPihcIm5vdGlmeVZpcnR1YWxTZWxlY3RlZFBhcmVudEJsdWVTY29yZUNoYW5nZWRSZXF1ZXN0XCIsIHt9LCBjYWxsYmFjayk7XG5cdH1cblxuXHRzdWJzY3JpYmVVdHhvc0NoYW5nZWQoYWRkcmVzc2VzOnN0cmluZ1tdLCBjYWxsYmFjazpScGMuY2FsbGJhY2s8UnBjLlV0eG9zQ2hhbmdlZE5vdGlmaWNhdGlvbj4pe1xuXHRcdHJldHVybiB0aGlzLnN1YnNjcmliZTxScGMuTm90aWZ5VXR4b3NDaGFuZ2VkUmVzcG9uc2UsIFJwYy5VdHhvc0NoYW5nZWROb3RpZmljYXRpb24+KFwibm90aWZ5VXR4b3NDaGFuZ2VkUmVxdWVzdFwiLCB7YWRkcmVzc2VzfSwgY2FsbGJhY2spO1xuXHR9XG5cblx0dW5TdWJzY3JpYmVVdHhvc0NoYW5nZWQodWlkOnN0cmluZz0nJyl7XG5cdFx0dGhpcy51blN1YnNjcmliZShcIm5vdGlmeVV0eG9zQ2hhbmdlZFJlcXVlc3RcIiwgdWlkKTtcblx0fVxuXG5cdGdldEJsb2NrKGhhc2g6c3RyaW5nKXtcblx0XHRyZXR1cm4gdGhpcy5yZXF1ZXN0PFJwYy5CbG9ja1Jlc3BvbnNlPignZ2V0QmxvY2tSZXF1ZXN0Jywge2hhc2gsIGluY2x1ZGVCbG9ja1ZlcmJvc2VEYXRhOnRydWV9KTtcblx0fVxuXHRnZXRUcmFuc2FjdGlvbnNCeUFkZHJlc3NlcyhzdGFydGluZ0Jsb2NrSGFzaDpzdHJpbmcsIGFkZHJlc3NlczpzdHJpbmdbXSl7XG5cdFx0cmV0dXJuIHRoaXMucmVxdWVzdDxScGMuVHJhbnNhY3Rpb25zQnlBZGRyZXNzZXNSZXNwb25zZT4oJ2dldFRyYW5zYWN0aW9uc0J5QWRkcmVzc2VzUmVxdWVzdCcsIHtcblx0XHRcdHN0YXJ0aW5nQmxvY2tIYXNoLCBhZGRyZXNzZXNcblx0XHR9KTtcblx0fVxuXHRnZXRVdHhvc0J5QWRkcmVzc2VzKGFkZHJlc3NlczpzdHJpbmdbXSl7XG5cdFx0cmV0dXJuIHRoaXMucmVxdWVzdDxScGMuVVRYT3NCeUFkZHJlc3Nlc1Jlc3BvbnNlPignZ2V0VXR4b3NCeUFkZHJlc3Nlc1JlcXVlc3QnLCB7YWRkcmVzc2VzfSk7XG5cdH1cblx0c3VibWl0VHJhbnNhY3Rpb24odHg6IFJwYy5TdWJtaXRUcmFuc2FjdGlvblJlcXVlc3Qpe1xuXHRcdHJldHVybiB0aGlzLnJlcXVlc3Q8UnBjLlN1Ym1pdFRyYW5zYWN0aW9uUmVzcG9uc2U+KCdzdWJtaXRUcmFuc2FjdGlvblJlcXVlc3QnLCB0eCk7XG5cdH1cblxuXHRnZXRWaXJ0dWFsU2VsZWN0ZWRQYXJlbnRCbHVlU2NvcmUoKXtcblx0XHRyZXR1cm4gdGhpcy5yZXF1ZXN0PFJwYy5WaXJ0dWFsU2VsZWN0ZWRQYXJlbnRCbHVlU2NvcmVSZXNwb25zZT4oJ2dldFZpcnR1YWxTZWxlY3RlZFBhcmVudEJsdWVTY29yZVJlcXVlc3QnLCB7fSk7XG5cdH1cbn0iXX0=