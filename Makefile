BROKER_IP ?= $(shell ipconfig getifaddr en0)

.PHONY: broker m0 mind deploy

broker:  ## start Mosquitto and show what's listening on 1883
	brew services start mosquitto
	lsof -iTCP:1883 -sTCP:LISTEN

m0:  ## simulated mech on this Mac; send a wave from another terminal
	PEAK_SIM=1 PEAK_BROKER=localhost python3 node/servod.py &
	sleep 2
	mosquitto_pub -t peak/mech/cmd -m '{"gesture":"wave"}'

mind:  ## run the orchestrator
	cd mind && npm start

deploy:  ## rsync node/ to the Pi and restart servod
	scripts/deploy-node.sh $(or $(HOST),mech.local)
