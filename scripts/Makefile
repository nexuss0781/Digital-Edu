CXX = g++
CXXFLAGS = -std=c++17 -O3 -Wall -Wextra

TARGET = workshop_grouper
SRC = workshop_grouper.cpp

.PHONY: all clean

all: $(TARGET)

$(TARGET): $(SRC)
	$(CXX) $(CXXFLAGS) -o $@ $<

run: $(TARGET)
	./$(TARGET) ../courses workshop_groups.json

clean:
	rm -f $(TARGET) workshop_groups.json
